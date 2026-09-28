import { createHash } from "node:crypto";
import { Client } from "pg";
import { parse as parseCsv } from "@fast-csv/parse";
import iconv from "iconv-lite";
import { Readable } from "node:stream";
import * as XLSX from "xlsx";
import type { PriceCurrency } from "@/lib/currency";
import type { PriceColumnMapping } from "@/lib/price-format";
import type { AdminRequestContext } from "@/lib/admin-auth";
import {
  importStream,
  processRow,
  streamXlsxRows,
  type Counters,
  type ImportStatus,
  type UploadMeta,
} from "@/lib/price-import";

/** Durable state shared by the HTTP queue writer and the background worker. */
export type ProcessingSnapshot = {
  warehouseId: string;
  supplierId: string | null;
  filename: string;
  sourceFilePath: string;
  format: UploadMeta["format"];
  headers: string[];
  mapping: PriceColumnMapping;
  delimiter: string;
  encoding: string;
  firstRowHeaders: boolean;
  deleteMissing: boolean;
  priceCurrency: PriceCurrency;
  exchangeRate: string;
  exchangeRateSource: "manual";
  startedBy: string;
  estimatedRows: number;
};

export const IMPORT_BATCH_SIZE = 1000;
export const IMPORT_LEASE_MS = 5 * 60 * 1000;
const MAX_CHUNK_ROWS = IMPORT_BATCH_SIZE;

export function databaseUrl(): string {
  const value =
    process.env["POSTGRES_URL"] ??
    process.env["DATABASE_URL"] ??
    process.env["POSTGRES_PRISMA_URL"] ??
    process.env["POSTGRES_URL_NON_POOLING"];
  if (!value) throw new Error("DATABASE_URL is required for the import worker");
  return value;
}

export async function connectImportDatabase(): Promise<Client> {
  const client = new Client({
    connectionString: databaseUrl(),
    connectionTimeoutMillis: 10_000,
    query_timeout: 60_000,
  });
  await client.connect();
  return client;
}

export async function createProcessingSnapshot(
  client: Client,
  runId: string,
  snapshot: ProcessingSnapshot,
): Promise<void> {
  await client.query(
    `UPDATE import_runs
        SET processing_snapshot=$2::jsonb, status='queued',
            rows_total=$3, prepared_through_row=0, next_batch_number=1
      WHERE id=$1`,
    [runId, JSON.stringify(snapshot), snapshot.estimatedRows],
  );
}

export async function getProcessingSnapshot(
  client: Client,
  runId: string,
): Promise<ProcessingSnapshot> {
  const result = await client.query<{ processing_snapshot: ProcessingSnapshot | null }>(
    `SELECT processing_snapshot FROM import_runs WHERE id=$1`,
    [runId],
  );
  const snapshot = result.rows[0]?.processing_snapshot;
  if (!snapshot) throw new Error(`Import run ${runId} has no immutable processing snapshot`);
  return snapshot;
}

export async function claimPreparingRun(client: Client, workerId: string): Promise<string | null> {
  const result = await client.query<{ id: string }>(
    `WITH candidate AS (
       SELECT id FROM import_runs
        WHERE processing_snapshot IS NOT NULL
          AND (
            (status='queued' AND (preparation_lease_until IS NULL OR preparation_lease_until < clock_timestamp()))
            OR (status='preparing' AND preparation_lease_until < clock_timestamp())
          )
        ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1
     )
     UPDATE import_runs r
        SET status='preparing', preparation_worker_id=$1,
            preparation_lease_until=clock_timestamp() + interval '5 minutes',
            preparation_heartbeat_at=clock_timestamp(), preparation_attempts=preparation_attempts+1
       FROM candidate c WHERE r.id=c.id RETURNING r.id::text`,
    [workerId],
  );
  return result.rows[0]?.id ?? null;
}

export async function heartbeatPreparation(
  client: Client,
  runId: string,
  workerId: string,
): Promise<boolean> {
  const result = await client.query(
    `UPDATE import_runs SET preparation_heartbeat_at=clock_timestamp(), preparation_lease_until=clock_timestamp()+interval '5 minutes'
      WHERE id=$1 AND status='preparing' AND preparation_worker_id=$2
        AND preparation_lease_until > clock_timestamp()`,
    [runId, workerId],
  );
  return result.rowCount === 1;
}

function chunkPath(runId: string, batchNumber: number): string {
  return `imports/${runId}/chunks/${String(batchNumber).padStart(6, "0")}.ndjson`;
}

async function putChunk(pathname: string, body: string): Promise<void> {
  const token = process.env["BLOB_READ_WRITE_TOKEN"];
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is required for import chunks");
  const { put } = await import("@vercel/blob");
  await put(pathname, body, { access: "private", addRandomSuffix: false, allowOverwrite: true });
}

async function readChunk(pathname: string): Promise<Readable> {
  const { get } = await import("@vercel/blob");
  const object = await get(pathname, { access: "private", useCache: false });
  if (!object || object.statusCode !== 200) throw new Error(`Chunk ${pathname} not found`);
  return Readable.fromWeb(object.stream as import("node:stream/web").ReadableStream);
}

export async function prepareImportBatches(
  client: Client,
  runId: string,
  workerId: string,
): Promise<void> {
  const snapshot = await getProcessingSnapshot(client, runId);
  const context: AdminRequestContext = { adminRuntime: { cloudflare: false } };
  const meta: UploadMeta = {
    tempFileId: `run_${runId}`,
    filePath: snapshot.sourceFilePath,
    filename: snapshot.filename,
    format: snapshot.format,
    headers: snapshot.headers,
    mapping: snapshot.mapping,
    delimiter: snapshot.delimiter,
    encoding: snapshot.encoding,
    firstRowHeaders: snapshot.firstRowHeaders,
    estimatedRows: 0,
    deleteMissing: snapshot.deleteMissing,
    priceCurrency: snapshot.priceCurrency,
    exchangeRate: snapshot.exchangeRate,
    exchangeRateSource: snapshot.exchangeRateSource,
    retainForRetry: true,
  };
  let batchNumber = Number(
    (
      await client.query<{ next_batch_number: string }>(
        `SELECT next_batch_number::text FROM import_runs WHERE id=$1 FOR UPDATE`,
        [runId],
      )
    ).rows[0]?.next_batch_number ?? 1,
  );
  const preparedThroughRow = Number(
    (
      await client.query<{ prepared_through_row: string }>(
        `SELECT prepared_through_row::text FROM import_runs WHERE id=$1`,
        [runId],
      )
    ).rows[0]?.prepared_through_row ?? 0,
  );
  let rows: Array<{ rowNumber: number; values: string[] }> = [];
  const flush = async () => {
    if (!rows.length) return;
    const body = rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
    const path = chunkPath(runId, batchNumber);
    const hash = createHash("sha256").update(body).digest("hex");
    await putChunk(path, body);
    await client.query(
      `INSERT INTO import_run_batches(import_run_id,batch_number,row_start,row_end,row_count,chunk_path,chunk_hash,source_cursor_start,source_cursor_end)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)
       ON CONFLICT (import_run_id,batch_number) DO UPDATE SET chunk_path=EXCLUDED.chunk_path,chunk_hash=EXCLUDED.chunk_hash
       WHERE import_run_batches.chunk_hash=EXCLUDED.chunk_hash`,
      [
        runId,
        batchNumber,
        rows[0]!.rowNumber,
        rows.at(-1)!.rowNumber,
        rows.length,
        path,
        hash,
        JSON.stringify({ row: rows[0]!.rowNumber }),
        JSON.stringify({ row: rows.at(-1)!.rowNumber }),
      ],
    );
    const checkpoint = await client.query(
      `UPDATE import_runs SET prepared_through_row=$2,next_batch_number=$3,preparation_heartbeat_at=clock_timestamp(),preparation_lease_until=clock_timestamp()+interval '5 minutes'
        WHERE id=$1 AND status='preparing' AND preparation_worker_id=$4
          AND preparation_lease_until > clock_timestamp()`,
      [runId, rows.at(-1)!.rowNumber, batchNumber + 1, workerId],
    );
    if (checkpoint.rowCount !== 1 || !(await heartbeatPreparation(client, runId, workerId)))
      throw new Error("Preparation lease ownership was lost before checkpoint");
    batchNumber += 1;
    rows = [];
  };
  if (snapshot.format === "xlsx") {
    let headers = snapshot.headers;
    let firstRow = true;
    for await (const item of streamXlsxRows(() => importStream(meta, context))) {
      const values = item.values.slice(1).map(String);
      if (firstRow && snapshot.firstRowHeaders) {
        headers = values;
        firstRow = false;
        continue;
      }
      firstRow = false;
      if (item.number <= preparedThroughRow) continue;
      rows.push({ rowNumber: item.number, values });
      if (rows.length >= MAX_CHUNK_ROWS) await flush();
      if (rows.length % 100 === 0 && !(await heartbeatPreparation(client, runId, workerId)))
        throw new Error("Preparation lease ownership was lost");
    }
  } else if (snapshot.format === "xls") {
    const input = await importStream(meta, context);
    const buffers: Buffer[] = [];
    let totalBytes = 0;
    for await (const value of input) {
      const buffer = Buffer.from(value as Uint8Array);
      totalBytes += buffer.byteLength;
      if (totalBytes > 50 * 1024 * 1024)
        throw new Error("XLS-файл больше 50 МБ: используйте XLSX или CSV");
      buffers.push(buffer);
    }
    const workbook = XLSX.read(Buffer.concat(buffers), { type: "buffer", raw: false });
    const sheet = workbook.Sheets[workbook.SheetNames[0] ?? ""];
    if (!sheet) throw new Error("В Excel-файле нет листов");
    const sourceRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false });
    for (let index = 0; index < sourceRows.length; index += 1) {
      const rowNumber = index + 1;
      const values = sourceRows[index]!.map((value) => String(value ?? ""));
      if (rowNumber === 1 && snapshot.firstRowHeaders) {
        continue;
      }
      if (rowNumber <= preparedThroughRow) continue;
      rows.push({ rowNumber, values });
      if (rows.length >= MAX_CHUNK_ROWS) await flush();
      if (rowNumber % 100 === 0 && !(await heartbeatPreparation(client, runId, workerId)))
        throw new Error("Preparation lease ownership was lost");
    }
  } else {
    const input = await importStream(meta, context);
    const decoded = input.pipe(
      iconv.decodeStream(snapshot.encoding === "windows-1251" ? "win1251" : "utf8"),
    );
    const parser = decoded.pipe(
      parseCsv({
        delimiter: snapshot.delimiter || ",",
        headers: false,
        ignoreEmpty: true,
        trim: true,
      }),
    );
    let line = 0;
    let headers = snapshot.headers;
    for await (const parsed of parser) {
      line += 1;
      const values = parsed as string[];
      if (line === 1 && snapshot.firstRowHeaders) {
        headers = values;
        continue;
      }
      if (line <= preparedThroughRow) continue;
      rows.push({ rowNumber: line, values });
      if (rows.length >= MAX_CHUNK_ROWS) await flush();
      if (line % 100 === 0 && !(await heartbeatPreparation(client, runId, workerId)))
        throw new Error("Preparation lease ownership was lost");
    }
  }
  await flush();
  const finished = await client.query(
    `UPDATE import_runs SET status='running',preparation_finished_at=clock_timestamp(),preparation_lease_until=NULL,preparation_worker_id=NULL
      WHERE id=$1 AND status='preparing' AND preparation_worker_id=$2 AND preparation_lease_until > clock_timestamp()`,
    [runId, workerId],
  );
  if (finished.rowCount !== 1)
    throw new Error("Preparation lease ownership was lost before completion");
}

export async function claimNextBatch(
  client: Client,
  workerId: string,
): Promise<{ id: string; runId: string; batchNumber: number; chunkPath: string } | null> {
  const result = await client.query<{
    id: string;
    import_run_id: string;
    batch_number: number;
    chunk_path: string;
  }>(
    `WITH candidate AS (
       SELECT b0.id, b0.import_run_id, b0.batch_number
         FROM import_run_batches b0
         JOIN import_runs r0 ON r0.id=b0.import_run_id
        WHERE b0.status IN ('queued','processing') AND r0.status='running'
          AND (b0.next_attempt_at IS NULL OR b0.next_attempt_at <= clock_timestamp())
          AND (b0.lease_until IS NULL OR b0.lease_until < clock_timestamp())
          AND (r0.worker_id IS NULL OR r0.worker_id=$1 OR r0.lease_until IS NULL OR r0.lease_until < clock_timestamp())
        ORDER BY b0.import_run_id,b0.batch_number
        FOR UPDATE OF b0, r0 SKIP LOCKED LIMIT 1
     ), claimed_run AS (
       UPDATE import_runs r
          SET worker_id=$1, lease_until=clock_timestamp()+interval '5 minutes',
              heartbeat_at=clock_timestamp(), current_batch_number=(SELECT batch_number FROM candidate),
              attempt_count=attempt_count+1
        WHERE r.id=(SELECT import_run_id FROM candidate) AND r.status='running'
          AND (r.worker_id IS NULL OR r.worker_id=$1 OR r.lease_until IS NULL OR r.lease_until < clock_timestamp())
        RETURNING r.id
     )
     UPDATE import_run_batches b
        SET status='processing',worker_id=$1,lease_until=clock_timestamp()+interval '5 minutes',
            heartbeat_at=clock_timestamp(),attempts=attempts+1,started_at=COALESCE(started_at,clock_timestamp())
       FROM candidate c JOIN claimed_run r ON r.id=c.import_run_id
      WHERE b.id=c.id
      RETURNING b.id::text,b.import_run_id::text,b.batch_number,b.chunk_path`,
    [workerId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    runId: row.import_run_id,
    batchNumber: Number(row.batch_number),
    chunkPath: row.chunk_path,
  };
}

export async function heartbeatBatch(
  client: Client,
  batchId: string,
  runId: string,
  workerId: string,
): Promise<boolean> {
  // Heartbeats must be committed independently of the batch transaction so a
  // long-running batch cannot hold the lease update invisible until commit.
  const heartbeatClient = await connectImportDatabase();
  try {
    await heartbeatClient.query("BEGIN");
    const result = await heartbeatClient.query(
      `WITH eligible_run AS (
         SELECT id FROM import_runs
          WHERE id=$3 AND status='running' AND worker_id=$2
            AND lease_until > clock_timestamp()
          FOR UPDATE
       ), touched_batch AS (
         UPDATE import_run_batches b
            SET heartbeat_at=clock_timestamp(),lease_until=clock_timestamp()+interval '5 minutes'
           FROM eligible_run r
          WHERE b.id=$1 AND b.import_run_id=r.id AND b.worker_id=$2
            AND b.status='processing' AND b.lease_until > clock_timestamp()
          RETURNING b.import_run_id
       )
       UPDATE import_runs r
          SET heartbeat_at=clock_timestamp(),lease_until=clock_timestamp()+interval '5 minutes'
         FROM touched_batch b
        WHERE r.id=b.import_run_id AND r.id=$3 AND r.worker_id=$2
          AND r.status='running' AND r.lease_until > clock_timestamp()
        RETURNING r.id`,
      [batchId, workerId, runId],
    );
    if (result.rowCount !== 1) {
      await heartbeatClient.query("ROLLBACK");
      return false;
    }
    await heartbeatClient.query("COMMIT");
    return true;
  } finally {
    await heartbeatClient.end();
  }
}

export async function retryBatch(
  client: Client,
  batchId: string,
  workerId: string,
  error: unknown,
): Promise<void> {
  await client.query(
    `UPDATE import_run_batches
        SET status=CASE WHEN attempts >= 5 THEN 'failed' ELSE 'queued' END,
            next_attempt_at=CASE WHEN attempts >= 5 THEN NULL ELSE clock_timestamp() + make_interval(secs => LEAST(300, power(2, attempts)::int * 5)) END,
            lease_until=NULL, worker_id=NULL, last_error=$3
      WHERE id=$1 AND status='processing' AND worker_id=$2 AND lease_until > clock_timestamp()`,
    [batchId, workerId, error instanceof Error ? error.message : String(error)],
  );
}

export async function completeBatchAndCounters(
  client: Client,
  batchId: string,
  workerId: string,
  runId: string,
  batchNumber: number,
  counters: Counters,
): Promise<boolean> {
  const result = await client.query(
    `WITH completed AS (
       UPDATE import_run_batches
          SET status='completed', finished_at=now(), lease_until=NULL, worker_id=NULL,
              rows_processed=$4, rows_created=$5, rows_updated=$6, rows_skipped=$7,
              rows_duplicate=$8, error_count=$9
        WHERE id=$1 AND status='processing' AND worker_id=$2 AND lease_until > clock_timestamp()
        RETURNING import_run_id
     )
     UPDATE import_runs r
        SET rows_processed=rows_processed+$4, rows_created=rows_created+$5,
            rows_updated=rows_updated+$6, rows_skipped=rows_skipped+$7,
            rows_duplicate=rows_duplicate+$8, error_count=error_count+$9,
            current_batch_number=$3, heartbeat_at=now()
       FROM completed c
      WHERE r.id=c.import_run_id AND r.id=$10 AND r.status='running'
        AND r.worker_id=$2 AND r.lease_until > clock_timestamp()
      RETURNING r.id`,
    [
      batchId,
      workerId,
      batchNumber,
      counters.rowsProcessed,
      counters.rowsCreated,
      counters.rowsUpdated,
      counters.rowsSkipped,
      counters.rowsDuplicate,
      counters.errorCount,
      runId,
    ],
  );
  if (result.rowCount !== 1) return false;
  return true;
}

export async function finalizeImportRun(client: Client, runId: string): Promise<void> {
  await client.query("BEGIN");
  try {
    const result = await client.query<{
      failed: string;
      remaining: string;
      errors: string;
      delete_missing: boolean;
      warehouse_id: string;
      started_by: string | null;
      snapshot: ProcessingSnapshot | null;
    }>(
      `SELECT count(*) FILTER (WHERE b.status='failed')::text failed,
              count(*) FILTER (WHERE b.status IN ('queued','processing'))::text remaining,
              coalesce(sum(b.error_count),0)::text errors,
              r.warehouse_id::text, r.started_by, r.processing_snapshot snapshot,
              coalesce((r.processing_snapshot->>'deleteMissing')::boolean,false) delete_missing
         FROM import_runs r LEFT JOIN import_run_batches b ON b.import_run_id=r.id
        WHERE r.id=$1 GROUP BY r.id`,
      [runId],
    );
    const row = result.rows[0];
    if (!row || Number(row.remaining) > 0 || !row.snapshot) {
      await client.query("ROLLBACK");
      return;
    }
    const status: ImportStatus =
      Number(row.failed) > 0 || Number(row.errors) > 0 ? "completed_with_errors" : "completed";
    if (status === "completed" && row.delete_missing) {
      await client.query(
        `UPDATE warehouse_products wp SET stock=0,updated_at=now()
          WHERE wp.warehouse_id=$1 AND NOT EXISTS (
            SELECT 1 FROM warehouse_product_import_keys k
             WHERE k.warehouse_id=wp.warehouse_id AND k.product_id=wp.product_id AND k.last_import_run_id=$2
          )`,
        [row.warehouse_id, runId],
      );
      await client.query(
        `UPDATE product_offers o SET stock=0,status='out_of_stock',updated_at=now()
          WHERE o.warehouse_id=$1 AND NOT EXISTS (
            SELECT 1 FROM warehouse_product_import_keys k
             WHERE k.warehouse_id=o.warehouse_id AND k.product_id=o.product_id AND k.last_import_run_id=$2
          )`,
        [row.warehouse_id, runId],
      );
    }
    await client.query(
      `UPDATE import_runs SET status=$2,finished_at=now(),heartbeat_at=now(),lease_until=NULL,worker_id=NULL WHERE id=$1 AND status='running'`,
      [runId, status],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

export async function processBatch(
  client: Client,
  batch: { id: string; runId: string; batchNumber: number; chunkPath: string },
  workerId: string,
): Promise<void> {
  const snapshot = await getProcessingSnapshot(client, batch.runId);
  const supplierId = snapshot.supplierId;
  const stream = await readChunk(batch.chunkPath);
  const chunks: string[] = [];
  for await (const value of stream) chunks.push(Buffer.from(value as Uint8Array).toString("utf8"));
  const text = chunks.join("");
  const counters: Counters = {
    rowsTotal: 0,
    rowsProcessed: 0,
    rowsCreated: 0,
    rowsUpdated: 0,
    rowsSkipped: 0,
    rowsDuplicate: 0,
    errorCount: 0,
  };
  const seen = new Set<string>();
  await client.query("BEGIN");
  try {
    for (const line of text.split(/\r?\n/)) {
      if (!line) continue;
      const item = JSON.parse(line) as { rowNumber: number; values: string[] };
      await processRow(
        client,
        batch.runId,
        snapshot.warehouseId,
        supplierId,
        snapshot.headers,
        snapshot.mapping,
        item.values,
        item.rowNumber,
        seen,
        counters,
        snapshot.priceCurrency,
        snapshot.exchangeRate,
      );
      if (
        counters.rowsProcessed % 100 === 0 &&
        !(await heartbeatBatch(client, batch.id, batch.runId, workerId))
      )
        throw new Error("Batch lease ownership was lost during processing");
    }
    const completed = await completeBatchAndCounters(
      client,
      batch.id,
      workerId,
      batch.runId,
      batch.batchNumber,
      counters,
    );
    if (!completed) throw new Error("Batch lease ownership was lost before commit");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
  await finalizeImportRun(client, batch.runId);
}

export async function finalizeReadyImportRuns(client: Client): Promise<void> {
  const result = await client.query<{ id: string }>(
    `SELECT r.id::text
       FROM import_runs r
      WHERE r.status='running'
        AND EXISTS (SELECT 1 FROM import_run_batches b WHERE b.import_run_id=r.id)
        AND NOT EXISTS (
          SELECT 1 FROM import_run_batches b
           WHERE b.import_run_id=r.id AND b.status IN ('queued','processing')
        )
      ORDER BY r.id
      LIMIT 20`,
  );
  for (const row of result.rows) await finalizeImportRun(client, row.id);
}
