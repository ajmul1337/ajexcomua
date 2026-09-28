import {
  claimNextBatch,
  claimPreparingRun,
  connectImportDatabase,
  finalizeReadyImportRuns,
  finalizeImportRun,
  prepareImportBatches,
  processBatch,
  retryBatch,
} from "@/lib/import-jobs";

const workerId = process.env["IMPORT_WORKER_ID"] ?? `import-worker-${process.pid}`;
const pollMs = Math.max(1000, Number(process.env["IMPORT_WORKER_POLL_MS"] ?? 5000));
let stopping = false;

function validateEnvironment(): void {
  if (!process.env["BLOB_READ_WRITE_TOKEN"])
    throw new Error("BLOB_READ_WRITE_TOKEN is required for the import worker");
  if (!(
    process.env["DATABASE_URL"] ??
    process.env["POSTGRES_URL"] ??
    process.env["POSTGRES_PRISMA_URL"]
  ))
    throw new Error("DATABASE_URL is required for the import worker");
}

async function tick(): Promise<boolean> {
  const client = await connectImportDatabase();
  try {
    const preparing = await claimPreparingRun(client, workerId);
    if (preparing) {
      try {
        await prepareImportBatches(client, preparing, workerId);
      } catch (error) {
        await client.query(
          `UPDATE import_runs
              SET status='queued', preparation_last_error=$2,
                  preparation_lease_until=clock_timestamp() + make_interval(secs => LEAST(300, power(2, preparation_attempts)::int * 5)),
                  preparation_worker_id=NULL
            WHERE id=$1 AND status='preparing' AND preparation_worker_id=$3
              AND preparation_lease_until > clock_timestamp()`,
          [preparing, error instanceof Error ? error.message : String(error), workerId],
        );
      }
      return true;
    }
    const batch = await claimNextBatch(client, workerId);
    if (!batch) {
      await finalizeReadyImportRuns(client);
      return false;
    }
    try {
      await processBatch(client, batch, workerId);
    } catch (error) {
      await retryBatch(client, batch.id, workerId, error);
    }
    await finalizeReadyImportRuns(client);
    return true;
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  validateEnvironment();
  while (!stopping) {
    const didWork = await tick();
    if (!didWork) await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

const stop = () => {
  stopping = true;
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
