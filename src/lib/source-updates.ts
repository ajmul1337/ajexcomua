import { Client } from "pg";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import * as fsp from "node:fs/promises";
import { createWriteStream } from "node:fs";
import * as path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { queueServerSourceImport, type ServerSourceFile } from "@/lib/price-import";
import { getAdminRequestStatus, type AdminRequestContext } from "@/lib/admin-auth";

type SourceCredentials = { apiKey?: string; login?: string; password?: string };
type WarehouseSource = {
  id: string;
  name: string;
  source_type: "api" | "email" | "manual_upload";
  api_url: string | null;
  source_request_params: Record<string, unknown>;
  email_protocol: "imap";
  email_folder: string;
  email_from: string | null;
  email_subject: string | null;
  email_attachment_pattern: string | null;
  email_allowed_extensions: string[];
  update_frequency: string;
  update_timezone: string;
  update_time: string;
  source_credentials_ciphertext: string | null;
  source_credentials_iv: string | null;
};

const STORAGE_DIR = path.join(process.cwd(), "storage", "imports");
function connectionString(context: AdminRequestContext): string | undefined {
  return (
    context.adminRuntime?.bindings?.HYPERDRIVE?.connectionString ??
    process.env["POSTGRES_URL"] ??
    process.env["DATABASE_URL"] ??
    process.env["POSTGRES_PRISMA_URL"] ??
    process.env["POSTGRES_URL_NON_POOLING"]
  );
}
async function db(context: AdminRequestContext): Promise<Client> {
  const url = connectionString(context);
  if (!url) throw new Error("PostgreSQL не подключён");
  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: 10000,
    query_timeout: 60000,
  });
  await client.connect();
  return client;
}
function decode(value: string): Uint8Array {
  const standard = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = Buffer.from(standard + "=".repeat((4 - (standard.length % 4)) % 4), "base64");
  return new Uint8Array(binary);
}
async function decryptCredentials(
  row: WarehouseSource,
  context: AdminRequestContext,
): Promise<SourceCredentials> {
  if (!row.source_credentials_ciphertext || !row.source_credentials_iv) return {};
  const secret =
    context.adminRuntime?.bindings?.AJEX_CREDENTIALS_KEY ?? process.env["AJEX_CREDENTIALS_KEY"];
  if (!secret) throw new Error("AJEX_CREDENTIALS_KEY is not configured");
  const keyBytes = decode(secret);
  if (keyBytes.length !== 32) throw new Error("AJEX_CREDENTIALS_KEY must encode 32 bytes");
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes.buffer as ArrayBuffer,
    "AES-GCM",
    false,
    ["decrypt"],
  );
  const plain = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: decode(row.source_credentials_iv).buffer as ArrayBuffer,
      additionalData: new TextEncoder().encode(`ajex-warehouse:${row.id}`),
    },
    key,
    decode(row.source_credentials_ciphertext).buffer as ArrayBuffer,
  );
  return JSON.parse(new TextDecoder().decode(plain)) as SourceCredentials;
}
function nextUpdate(
  frequency: string,
  timezone: string,
  updateTime: string,
  now = new Date(),
): Date {
  const result = new Date(now);
  const [hourText, minuteText] = updateTime.split(":");
  const hour = Number(hourText) || 3;
  const minute = Number(minuteText) || 0;
  if (frequency === "hourly") result.setUTCMinutes(result.getUTCMinutes() + 60, 0, 0);
  else if (frequency === "weekly") {
    result.setUTCDate(result.getUTCDate() + 7);
    result.setUTCHours(hour, minute, 0, 0);
  } else {
    result.setUTCDate(result.getUTCDate() + 1);
    result.setUTCHours(hour, minute, 0, 0);
  }
  void timezone;
  return result;
}
async function saveSourceFile(
  filename: string,
  body: Uint8Array | ReadableStream<Uint8Array>,
  context: AdminRequestContext,
): Promise<string> {
  const id = `source_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const safe = filename.replace(/[^\p{L}\p{N}._-]/gu, "_").slice(0, 180) || "price.csv";
  const bucket = context.adminRuntime?.bindings?.IMPORTS_BUCKET;
  if (bucket) {
    const key = `imports/${id}_${safe}`;
    await bucket.put(key, body);
    return `r2://${key}`;
  }
  await fsp.mkdir(STORAGE_DIR, { recursive: true });
  const target = path.join(STORAGE_DIR, `${id}_${safe}`);
  if (body instanceof Uint8Array) await fsp.writeFile(target, body);
  else
    await pipeline(
      Readable.fromWeb(body as import("node:stream/web").ReadableStream),
      createWriteStream(target),
    );
  return target;
}
async function removeSourceFile(filePath: string, context: AdminRequestContext): Promise<void> {
  if (filePath.startsWith("r2://")) {
    await context.adminRuntime?.bindings?.IMPORTS_BUCKET?.delete(filePath.slice(5)).catch(
      () => undefined,
    );
  } else {
    await fsp.unlink(filePath).catch(() => undefined);
  }
}
export async function fetchApi(
  row: WarehouseSource,
  credentials: SourceCredentials,
): Promise<{ filename: string; body: ReadableStream<Uint8Array> }> {
  if (!row.api_url) throw new Error("API URL не настроен");
  const params = row.source_request_params ?? {};
  const headers = new Headers();
  if (credentials.apiKey) headers.set("Authorization", `Bearer ${credentials.apiKey}`);
  if (credentials.login && credentials.password) {
    headers.set(
      "Authorization",
      `Basic ${Buffer.from(`${credentials.login}:${credentials.password}`).toString("base64")}`,
    );
  } else if (credentials.login) headers.set("X-Login", credentials.login);
  const url = new URL(row.api_url);
  for (const [key, value] of Object.entries(params))
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`API ответил ${response.status}`);
  if (!response.body) throw new Error("API вернул пустое тело ответа");
  const disposition = response.headers.get("content-disposition") ?? "";
  const dispositionName = disposition.match(/filename\*?=(?:UTF-8''|")?([^;"]+)/i)?.[1];
  const filename =
    response.headers.get("x-filename") ??
    dispositionName ??
    `warehouse-${row.id}.${(response.headers.get("content-type") ?? "").includes("spreadsheet") ? "xlsx" : "csv"}`;
  return { filename, body: response.body };
}
export async function fetchEmail(
  row: WarehouseSource,
  credentials: SourceCredentials,
): Promise<{ filename: string; body: Uint8Array; messageId: string }> {
  const host = (row.source_request_params["host"] as string | undefined) ?? "";
  const port = Number(row.source_request_params["port"] ?? 993);
  if (!host || !credentials.login || !credentials.password)
    throw new Error("Не настроены IMAP host/login/password");
  const client = new ImapFlow({
    host,
    port,
    secure: port === 993,
    auth: { user: credentials.login, pass: credentials.password },
  });
  await client.connect();
  try {
    const lock = await client.getMailboxLock(row.email_folder || "INBOX");
    try {
      const mailbox = client.mailbox;
      const exists = mailbox && typeof mailbox === "object" ? mailbox.exists : 1;
      const range = `${Math.max(1, exists - 30)}:*`;
      for await (const message of client.fetch(range, { source: true, envelope: true })) {
        if (!message.source) continue;
        const parsed = await simpleParser(Buffer.from(message.source));
        if (
          row.email_from &&
          !(parsed.from?.value ?? []).some(
            (item) => item.address?.toLowerCase() === row.email_from?.toLowerCase(),
          )
        )
          continue;
        if (
          row.email_subject &&
          !String(parsed.subject ?? "")
            .toLowerCase()
            .includes(row.email_subject.toLowerCase())
        )
          continue;
        for (const attachment of parsed.attachments) {
          const ext = path
            .extname(attachment.filename ?? "")
            .slice(1)
            .toLowerCase();
          if (!row.email_allowed_extensions.includes(ext)) continue;
          if (
            row.email_attachment_pattern &&
            !new RegExp(row.email_attachment_pattern, "i").test(attachment.filename ?? "")
          )
            continue;
          return {
            filename: attachment.filename ?? `mail-${row.id}.${ext}`,
            body: new Uint8Array(attachment.content),
            messageId: parsed.messageId ?? String(message.uid),
          };
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
  throw new Error("Подходящее письмо с вложением не найдено");
}
async function loadWarehouse(client: Client, warehouseId: string): Promise<WarehouseSource> {
  const result = await client.query<WarehouseSource>(
    `SELECT id::text,name,source_type,api_url,source_request_params,email_protocol,email_folder,email_from,email_subject,email_attachment_pattern,email_allowed_extensions,update_frequency,update_timezone,update_time,source_credentials_ciphertext,source_credentials_iv FROM warehouses WHERE id=$1 AND is_active=true`,
    [warehouseId],
  );
  if (!result.rows[0]) throw new Error("Активный склад не найден");
  return result.rows[0];
}

async function waitForImport(
  client: Client,
  runId: string,
): Promise<{ status: string; errorCount: number }> {
  for (let attempt = 0; attempt < 360; attempt += 1) {
    const result = await client.query<{ status: string; error_count: string }>(
      "SELECT status, error_count FROM import_runs WHERE id=$1",
      [runId],
    );
    const row = result.rows[0];
    if (!row) throw new Error("Импорт не найден после постановки в очередь");
    if (["completed", "completed_with_errors", "failed"].includes(row.status)) {
      return { status: row.status, errorCount: Number(row.error_count) };
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error("Импорт выполняется слишком долго");
}
export async function enqueueSourceUpdate(
  warehouseId: string,
  context: AdminRequestContext,
  trigger: "scheduled" | "manual" = "manual",
): Promise<string> {
  const client = await db(context);
  try {
    const result = await client.query<{ id: string }>(
      `INSERT INTO warehouse_source_jobs(warehouse_id,trigger,status) VALUES($1,$2,'queued') ON CONFLICT (warehouse_id) WHERE status IN ('queued','running') DO UPDATE SET scheduled_for=now() RETURNING id::text`,
      [warehouseId, trigger],
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error("Не удалось поставить обновление в очередь");
    const task = runSourceUpdate(id, context);
    if (context.adminRuntime?.waitUntil) context.adminRuntime.waitUntil(task);
    else setImmediate(() => void task);
    return id;
  } finally {
    await client.end();
  }
}
export async function runSourceUpdate(jobId: string, context: AdminRequestContext): Promise<void> {
  const client = await db(context);
  let warehouseId = "";
  let filePath: string | undefined;
  let handedOff = false;
  try {
    const claimed = await client.query<{ warehouse_id: string }>(
      `UPDATE warehouse_source_jobs SET status='running',started_at=now(),attempts=attempts+1 WHERE id=$1 AND status='queued' RETURNING warehouse_id::text`,
      [jobId],
    );
    warehouseId = claimed.rows[0]?.warehouse_id ?? "";
    if (!warehouseId) return;
    const row = await loadWarehouse(client, warehouseId);
    const credentials = await decryptCredentials(row, context);
    const source =
      row.source_type === "api"
        ? await fetchApi(row, credentials)
        : await fetchEmail(row, credentials);
    filePath = await saveSourceFile(source.filename, source.body, context);
    const sourceFile: ServerSourceFile = {
      warehouseId,
      filename: source.filename,
      filePath,
      source: row.source_type === "api" ? "scheduled_api" : "scheduled_email",
    };
    const runId = await queueServerSourceImport(sourceFile, context);
    handedOff = true;
    const importResult = await waitForImport(client, runId);
    await client.query(
      `UPDATE warehouse_source_jobs SET status=$2,finished_at=now(),source_filename=$3,source_message_id=$4,import_run_id=$5,error=$6 WHERE id=$1`,
      [
        jobId,
        importResult.status === "failed" ? "failed" : "completed",
        source.filename,
        "messageId" in source ? source.messageId : null,
        runId,
        importResult.status === "completed_with_errors"
          ? `Импорт завершён с ${importResult.errorCount} ошибками`
          : null,
      ],
    );
    await client.query(
      `UPDATE warehouses SET source_last_checked_at=now(),source_last_error=$2,next_update_at=$3,last_import_status=$4 WHERE id=$1`,
      [
        warehouseId,
        importResult.status === "failed" ? "Импорт завершился ошибкой" : null,
        nextUpdate(row.update_frequency, row.update_timezone, row.update_time),
        importResult.status === "completed_with_errors"
          ? "success_with_errors"
          : importResult.status === "failed"
            ? "failed"
            : "success",
      ],
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка получения прайса";
    await client
      .query(
        `UPDATE warehouse_source_jobs SET status='failed',finished_at=now(),error=$2 WHERE id=$1`,
        [jobId, message],
      )
      .catch(() => undefined);
    if (warehouseId)
      await client
        .query(
          `UPDATE warehouses SET source_last_checked_at=now(),source_last_error=$2,last_import_status='failed' WHERE id=$1`,
          [warehouseId, message],
        )
        .catch(() => undefined);
    if (filePath && !handedOff) await removeSourceFile(filePath, context);
  } finally {
    await client.end();
  }
}
export async function enqueueDueSourceUpdates(context: AdminRequestContext): Promise<number> {
  const client = await db(context);
  try {
    const rows = await client.query<{ id: string }>(
      `SELECT id::text FROM warehouses WHERE is_active=true AND auto_update_enabled=true AND source_type IN ('api','email') AND (next_update_at IS NULL OR next_update_at<=now()) ORDER BY id LIMIT 100`,
    );
    for (const row of rows.rows) await enqueueSourceUpdate(row.id, context, "scheduled");
    return rows.rowCount ?? 0;
  } finally {
    await client.end();
  }
}
export async function handleAdminSourceUpdatesApi(
  request: Request,
  context: AdminRequestContext,
): Promise<Response> {
  const auth = await getAdminRequestStatus(context);
  if (!auth.authenticated || auth.role !== "admin")
    return new Response("Forbidden", { status: 403 });
  const url = new URL(request.url);
  const id = url.searchParams.get("warehouseId");
  if (request.method === "POST" && id)
    return Response.json({ ok: true, jobId: await enqueueSourceUpdate(id, context) });
  const client = await db(context);
  try {
    const result = await client.query(
      `SELECT id::text,warehouse_id::text,trigger,status,scheduled_for,started_at,finished_at,attempts,source_filename,import_run_id::text,error,created_at FROM warehouse_source_jobs ${id ? "WHERE warehouse_id=$1" : ""} ORDER BY id DESC LIMIT 50`,
      id ? [id] : [],
    );
    return Response.json({ ok: true, jobs: result.rows });
  } finally {
    await client.end();
  }
}
