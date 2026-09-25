import { readdir, readFile } from "node:fs/promises";
import { Client } from "pg";

const connectionString =
  process.env.DATABASE_URL ??
  process.env.POSTGRES_URL ??
  process.env.POSTGRES_PRISMA_URL ??
  process.env.POSTGRES_URL_NON_POOLING;
if (!connectionString) {
  throw new Error("Set a PostgreSQL URL environment variable before migrating.");
}

const client = new Client({ connectionString, connectionTimeoutMillis: 10_000 });
try {
  await client.connect();
  await client.query(`
    CREATE TABLE IF NOT EXISTS ajex_schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const migrationsDirectory = new URL("./migrations/", import.meta.url);
  const migrations = (await readdir(migrationsDirectory))
    .filter((filename) => /^\d+_[a-z0-9_-]+\.sql$/i.test(filename))
    .sort();
  for (const name of migrations) {
    const applied = await client.query("SELECT 1 FROM ajex_schema_migrations WHERE name = $1", [
      name,
    ]);
    if (applied.rowCount) continue;
    const migration = await readFile(new URL(name, migrationsDirectory), "utf8");
    await client.query(migration);
    await client.query("INSERT INTO ajex_schema_migrations (name) VALUES ($1)", [name]);
    console.info(`Applied database migration ${name}.`);
  }
} finally {
  await client.end().catch(() => undefined);
}
