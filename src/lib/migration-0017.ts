/**
 * TEMPORARY: one-shot production migration endpoint for 0017 only.
 * Delete this module and its route after 0017 has been applied.
 * The SQL below is an operation-for-operation copy of
 * db/migrations/0017_import_cancellation.sql, executed inside the
 * transaction opened by runMigration0017 (the source migration's BEGIN/COMMIT
 * therefore have identical transaction boundaries).
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { Client } from "pg";

const MIGRATION_NAME = "0017_import_cancellation.sql";
const TOKEN_ENV = "AJEX_MIGRATION_0017_TOKEN";
const ADVISORY_LOCK_NAMESPACE = 170017;
const REQUIRED_MIGRATIONS = [
  "0001_catalog.sql",
  "0002_warehouse_sources.sql",
  "0003_admin_auth.sql",
  "0004_price_import.sql",
  "0005_source_updates.sql",
  "0006_cross_links.sql",
  "0007_product_offers.sql",
  "0008_catalog_search.sql",
  "0009_vehicle_catalog.sql",
  "0010_product_attributes.sql",
  "0011_product_admin_audit.sql",
  "0012_import_history.sql",
  "0013_import_safety.sql",
  "0014_tecdoc_readiness.sql",
  "0015_currency_exchange.sql",
  "0016_import_batches.sql",
] as const;

// Exact operation body from 0017_import_cancellation.sql. Its BEGIN/COMMIT
// are represented by runMigration0017's BEGIN/COMMIT so all checks, the
// migration body, journal entry, and verification share one transaction.
const MIGRATION_BODY = `
DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT c.conname
      FROM pg_constraint c
     WHERE c.conrelid = 'import_runs'::regclass
       AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) LIKE '%status%'
       AND pg_get_constraintdef(c.oid) LIKE '%queued%'
       AND pg_get_constraintdef(c.oid) LIKE '%completed%'
  LOOP
    EXECUTE format('ALTER TABLE import_runs DROP CONSTRAINT %I', constraint_name);
  END LOOP;

  ALTER TABLE import_runs
    ADD CONSTRAINT import_runs_status_check
    CHECK (status IN (
      'queued',
      'preparing',
      'running',
      'completed',
      'completed_with_errors',
      'failed',
      'canceled'
    ));
END $$;
`;

type ImportSnapshot = {
  id: string;
  status: string;
  rows_total: string;
  rows_processed: string;
  rows_created: string;
  rows_updated: string;
  rows_skipped: string;
  worker_id: string | null;
  heartbeat_at: string | null;
  lease_until: string | null;
};

function tokenMatches(provided: string | null, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const providedDigest = createHash("sha256").update(provided).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

function connectionString(): string | undefined {
  return (
    process.env["POSTGRES_URL"] ??
    process.env["DATABASE_URL"] ??
    process.env["POSTGRES_PRISMA_URL"] ??
    process.env["POSTGRES_URL_NON_POOLING"]
  );
}

function unauthorized(): Response {
  return new Response(null, { status: 404 });
}

function snapshotEqual(before: ImportSnapshot[], after: ImportSnapshot[]): boolean {
  return JSON.stringify(before) === JSON.stringify(after);
}

async function importSnapshot(client: Client): Promise<ImportSnapshot[]> {
  const result = await client.query<ImportSnapshot>(
    `SELECT id::text,status,rows_total::text,rows_processed::text,rows_created::text,
            rows_updated::text,rows_skipped::text,worker_id,heartbeat_at::text,lease_until::text
       FROM import_runs WHERE id IN (1,2,3) ORDER BY id`,
  );
  return result.rows;
}

async function runMigration0017(
  client: Client,
): Promise<
  | { status: "applied"; migration: string }
  | { status: "already_applied"; migration: string }
  | { status: "prerequisites_missing" }
> {
  await client.query("BEGIN");
  try {
    await client.query("SELECT pg_advisory_xact_lock($1)", [ADVISORY_LOCK_NAMESPACE]);
    const required = await client.query<{ name: string }>(
      `SELECT name FROM ajex_schema_migrations WHERE name = ANY($1::text[])`,
      [REQUIRED_MIGRATIONS],
    );
    const applied = new Set(required.rows.map((row) => row.name));
    if (REQUIRED_MIGRATIONS.some((name) => !applied.has(name))) {
      await client.query("ROLLBACK");
      return { status: "prerequisites_missing" };
    }

    const existing = await client.query(`SELECT 1 FROM ajex_schema_migrations WHERE name=$1`, [
      MIGRATION_NAME,
    ]);
    if (existing.rowCount) {
      await client.query("ROLLBACK");
      return { status: "already_applied", migration: MIGRATION_NAME };
    }

    const before = await importSnapshot(client);
    const countBefore = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM import_runs`,
    );
    await client.query(MIGRATION_BODY);
    await client.query(`INSERT INTO ajex_schema_migrations (name) VALUES ($1)`, [MIGRATION_NAME]);
    const journalEntry = await client.query(`SELECT 1 FROM ajex_schema_migrations WHERE name=$1`, [
      MIGRATION_NAME,
    ]);
    if (!journalEntry.rowCount) throw new Error("migration journal verification failed");

    const check = await client.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(c.oid) AS definition
         FROM pg_constraint c
        WHERE c.conrelid='import_runs'::regclass
          AND c.contype='c'
          AND pg_get_constraintdef(c.oid) LIKE '%canceled%'`,
    );
    if (!check.rowCount) throw new Error("migration verification failed");
    const after = await importSnapshot(client);
    if (!snapshotEqual(before, after)) throw new Error("import snapshot changed");
    const countAfter = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM import_runs`,
    );
    if (countBefore.rows[0]?.count !== countAfter.rows[0]?.count)
      throw new Error("import_runs count changed");

    await client.query("COMMIT");
    return { status: "applied", migration: MIGRATION_NAME };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

export async function handleMigration0017(request: Request): Promise<Response> {
  if (request.method !== "POST") return unauthorized();
  const authorization = request.headers.get("authorization");
  const provided = authorization?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
  if (!tokenMatches(provided, process.env[TOKEN_ENV])) return unauthorized();

  const url = connectionString();
  if (!url) return Response.json({ status: "unavailable" }, { status: 503 });
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 10_000 });
  try {
    await client.connect();
    return Response.json(await runMigration0017(client));
  } catch {
    return Response.json({ status: "failed" }, { status: 500 });
  } finally {
    await client.end().catch(() => undefined);
  }
}
