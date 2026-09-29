import { Client } from "pg";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { Readable } from "node:stream";
import * as XLSX from "xlsx";
import { parse as parseCsv } from "@fast-csv/parse";
import iconv from "iconv-lite";
import unzipper from "unzipper";
import sax from "sax";
import { verifyAdminRequest, type AdminRequestContext } from "@/lib/admin-auth";
import { resolveExchangeRate, type PriceCurrency } from "@/lib/currency";
import {
  detectPriceColumns,
  detectPriceFormat,
  type PriceColumn,
  type PriceColumnMapping,
} from "@/lib/price-format";

export type ImportStatus =
  | "queued"
  | "preparing"
  | "running"
  | "completed"
  | "completed_with_errors"
  | "failed"
  | "canceled";
export type ImportRun = {
  id: string;
  filename: string;
  status: ImportStatus;
  warehouseId: string | null;
  warehouseName: string | null;
  supplierName: string | null;
  supplierId: string | null;
  source: string | null;
  startedBy: string | null;
  retryOfRunId: string | null;
  safetyWarnings: string[];
  rowsTotal: number;
  rowsProcessed: number;
  rowsCreated: number;
  rowsUpdated: number;
  rowsSkipped: number;
  rowsDuplicate: number;
  errorCount: number;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  summary: string | null;
  columnMapping: PriceColumnMapping | null;
  priceCurrency: PriceCurrency | null;
  exchangeRate: string | null;
  exchangeRateSource: "manual" | null;
  workerId: string | null;
  leaseUntil: string | null;
  heartbeatAt: string | null;
  preparationWorkerId: string | null;
  preparationLeaseUntil: string | null;
  preparationHeartbeatAt: string | null;
  createdAt: string;
};
export type ImportError = {
  id: string;
  importRunId: string;
  filename: string;
  warehouseName: string | null;
  rowNumber: number | null;
  code: string;
  message: string;
  rawValue: string | null;
  createdAt: string;
};

const MAX_UPLOAD_BYTES = 250 * 1024 * 1024;
const MAX_SHARED_STRING_ENTRIES = 2_000_000;
const MAX_SHARED_STRING_BYTES = 128 * 1024 * 1024;
const MAX_XLSX_QUEUE_ROWS = 4_096;
const MAX_LEGACY_XLS_BYTES = 50 * 1024 * 1024;
const PREVIEW_ROWS = 25;
const STORAGE_DIR = path.join(process.cwd(), "storage", "imports");
const REQUIRED: PriceColumn[] = ["article", "brand"];
const BLOB_PREFIX = "blob://";

function isBlobPath(value: string): boolean {
  return value.startsWith(BLOB_PREFIX);
}

function blobPath(value: string): string {
  return value.slice(BLOB_PREFIX.length);
}

async function getVercelBlob(pathname: string) {
  const { get } = await import("@vercel/blob");
  const object = await get(pathname, { access: "private", useCache: false });
  if (!object || object.statusCode !== 200)
    throw new Error("Загруженный файл не найден в хранилище");
  return object;
}

async function deleteVercelBlob(pathname: string): Promise<void> {
  const { del } = await import("@vercel/blob");
  await del(pathname);
}

async function getVercelBlobStream(pathname: string): Promise<Readable> {
  const object = await getVercelBlob(pathname);
  return Readable.fromWeb(object.stream as import("node:stream/web").ReadableStream);
}

async function getVercelBlobArrayBuffer(pathname: string): Promise<ArrayBuffer> {
  const object = await getVercelBlob(pathname);
  return new Response(object.stream).arrayBuffer();
}

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
    connectionTimeoutMillis: 10_000,
    query_timeout: 60_000,
  });
  await client.connect();
  return client;
}

async function requireAdmin(
  request: Request,
  context: AdminRequestContext,
): Promise<{ username?: string }> {
  const auth = await verifyAdminRequest(request, context);
  if (!auth.authenticated || auth.role !== "admin")
    throw new Response("Требуется авторизация администратора", { status: 401 });
  return auth;
}

function safeName(name: string): string {
  return name.replace(/[^\p{L}\p{N}._-]/gu, "_").slice(0, 180) || "price";
}

function normalizeArticle(value: string): string {
  return value
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}
function normalizeBrand(value: string): string {
  return value.normalize("NFKC").trim().toUpperCase();
}
function numberValue(value: unknown): string | null {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!raw) return null;
  const cleaned = raw
    .replace(/[\s\u00a0]/g, "")
    .replace(/[₴$€₽]|грн|uah|rub|eur|usd/gi, "")
    .replace(/,/g, ".");
  if (!/^\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.split(".");
  if (fraction.length > 6) return null;
  return `${(whole ?? "0").replace(/^0+(?=\d)/, "")}.${fraction.padEnd(2, "0")}`;
}
function stockValue(value: unknown): number | null {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!raw) return null;
  if (raw === ">9") return 10;
  if (["да", "есть", "в наличии", "много", "+", "yes"].includes(raw)) return 1;
  if (["нет", "-", "no", "под заказ"].includes(raw)) return 0;
  if (!/^\d+(?:[.,]\d+)?$/.test(raw)) return null;
  const number = Number(raw.replace(",", "."));
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null;
}
function leadTimeValue(value: unknown): number | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const match = raw.match(/\d+(?:[.,]\d+)?/);
  if (!match) return null;
  const days = Number(match[0].replace(",", "."));
  return Number.isFinite(days) && days >= 0 ? Math.ceil(days) : null;
}
function delimiterFor(value: string | undefined): string {
  return value === "comma" ? "," : value === "tab" ? "\t" : value === "semicolon" ? ";" : "";
}
function parseCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      cells.push(cell.trim());
      cell = "";
    } else cell += char;
  }
  cells.push(cell.trim());
  return cells;
}
function csvDelimiter(sample: string): string {
  const line = sample.split(/\r?\n/).find((item) => item.trim()) ?? "";
  const choices = [";", ",", "\t"];
  return choices.sort((a, b) => line.split(b).length - line.split(a).length)[0] ?? ";";
}
function excelCellText(cell: unknown, sharedStrings?: Map<number, string>): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "object") {
    if ("text" in cell) return String((cell as { text: unknown }).text ?? "");
    if ("result" in cell) return String((cell as { result: unknown }).result ?? "");
    if ("richText" in cell) return String((cell as { richText: unknown }).richText ?? "");
    if ("sharedString" in cell && sharedStrings) {
      const index = Number((cell as { sharedString: unknown }).sharedString);
      return sharedStrings.get(index) ?? "";
    }
  }
  return String(cell);
}
function legacySheetInfo(sheet: XLSX.WorkSheet): XLSX.Range | null {
  const ref = sheet["!ref"];
  return ref ? XLSX.utils.decode_range(ref) : null;
}
function legacySheetRow(sheet: XLSX.WorkSheet, range: XLSX.Range, rowNumber: number): string[] {
  const row: string[] = [];
  for (let column = range.s.c; column <= range.e.c; column += 1) {
    const cell = sheet[XLSX.utils.encode_cell({ r: rowNumber, c: column })];
    row.push(excelCellText(cell));
  }
  return row;
}
type XlsxRow = { number: number; values: string[] };
class AsyncQueue<T> {
  private values: T[] = [];
  private waiters: ((result: IteratorResult<T>) => void)[] = [];
  private failure: unknown;
  private closed = false;
  push(value: T) {
    if (this.values.length >= MAX_XLSX_QUEUE_ROWS) {
      this.fail(new Error("XLSX parser queue limit exceeded"));
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter) waiter({ done: false, value });
    else this.values.push(value);
  }
  end() {
    this.closed = true;
    while (this.waiters.length) this.waiters.shift()?.({ done: true, value: undefined as never });
  }
  fail(error: unknown) {
    this.failure = error;
    this.end();
  }
  async next(): Promise<IteratorResult<T>> {
    if (this.failure) throw this.failure;
    const value = this.values.shift();
    if (value !== undefined) return { done: false, value };
    if (this.closed) return { done: true, value: undefined as never };
    return new Promise((resolve) => this.waiters.push(resolve));
  }
  [Symbol.asyncIterator]() {
    return this;
  }
}
async function readXlsxSharedStrings(input: Readable): Promise<Map<number, string>> {
  const shared = new Map<number, string>();
  let sharedBytes = 0;
  const zip = input.pipe(unzipper.Parse({ forceStream: true }));
  for await (const entry of zip) {
    if (entry.path !== "xl/sharedStrings.xml") {
      entry.autodrain();
      continue;
    }
    const parser = sax.createStream(true, { trim: false });
    let index = -1;
    let inItem = false;
    let text = "";
    parser.on("opentag", (node: { name: string }) => {
      if (node.name === "si") {
        inItem = true;
        text = "";
        index += 1;
      }
    });
    parser.on("text", (value: string) => {
      if (inItem) text += value;
    });
    parser.on("closetag", (name: string) => {
      if (name === "si") {
        sharedBytes += Buffer.byteLength(text, "utf8");
        if (index >= MAX_SHARED_STRING_ENTRIES || sharedBytes > MAX_SHARED_STRING_BYTES) {
          parser.emit("error", new Error("XLSX shared strings exceed memory limit"));
          return;
        }
        shared.set(index, text);
        inItem = false;
      }
    });
    await new Promise<void>((resolve, reject) => {
      parser.once("end", resolve);
      parser.once("error", reject);
      entry.pipe(parser);
    });
    break;
  }
  return shared;
}
async function* parseXlsxWorksheet(
  input: Readable,
  shared: Map<number, string>,
): AsyncGenerator<XlsxRow> {
  const zip = input.pipe(unzipper.Parse({ forceStream: true }));
  for await (const entry of zip) {
    if (!/^xl\/worksheets\/sheet1\.xml$/.test(entry.path)) {
      entry.autodrain();
      continue;
    }
    const queue = new AsyncQueue<XlsxRow>();
    const parser = sax.createStream(true, { trim: false });
    let row: string[] | null = null;
    let rowNumber = 0;
    let col = 0;
    let cellType = "";
    let cellValue = "";
    let inValue = false;
    parser.on("opentag", (node: { name: string; attributes: Record<string, string> }) => {
      if (node.name === "row") {
        row = [];
        rowNumber = Number(node.attributes["r"] ?? 0);
      } else if (node.name === "c") {
        cellType = node.attributes["t"] ?? "";
        const letters = (node.attributes["r"] ?? "").replace(/\d/g, "");
        col = 0;
        for (const char of letters) col = col * 26 + char.charCodeAt(0) - 64;
        cellValue = "";
      } else if (node.name === "v" || node.name === "t") inValue = true;
    });
    parser.on("text", (value: string) => {
      if (inValue) cellValue += value;
    });
    parser.on("closetag", (name: string) => {
      if (name === "v" || name === "t") inValue = false;
      if (name === "c" && row) {
        let value = cellValue;
        if (cellType === "s") value = shared.get(Number(value)) ?? "";
        while (row.length < col) row.push("");
        row[col - 1] = value;
      }
      if (name === "row" && row) {
        queue.push({ number: rowNumber, values: row });
        row = null;
      }
    });
    parser.once("end", () => queue.end());
    parser.once("error", (error) => queue.fail(error));
    entry.pipe(parser);
    for await (const item of queue) yield item;
    break;
  }
}
export async function* streamXlsxRows(
  inputFactory: () => Promise<Readable>,
): AsyncGenerator<XlsxRow> {
  const shared = await readXlsxSharedStrings(await inputFactory());
  yield* parseXlsxWorksheet(await inputFactory(), shared);
}
async function detectCsvDelimiter(meta: UploadMeta, context: AdminRequestContext): Promise<string> {
  if (isBlobPath(meta.filePath)) {
    const input = await getVercelBlobStream(blobPath(meta.filePath));
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of input) {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = Math.max(0, 64 * 1024 - bytes);
      if (remaining === 0) break;
      chunks.push(value.subarray(0, remaining));
      bytes += Math.min(value.byteLength, remaining);
      if (bytes >= 64 * 1024) break;
    }
    input.destroy();
    return csvDelimiter(
      iconv.decode(Buffer.concat(chunks), meta.encoding === "windows-1251" ? "win1251" : "utf8"),
    );
  }
  if (meta.filePath.startsWith("r2://")) {
    const object = await context.adminRuntime?.bindings?.IMPORTS_BUCKET?.get(
      meta.filePath.slice(5),
    );
    if (!object) throw new Error("Загруженный файл не найден в хранилище");
    const reader = object.body.getReader();
    const chunks: Buffer[] = [];
    let bytes = 0;
    while (bytes < 64 * 1024) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
      bytes += value.byteLength;
    }
    await reader.cancel();
    return csvDelimiter(
      iconv.decode(Buffer.concat(chunks), meta.encoding === "windows-1251" ? "win1251" : "utf8"),
    );
  }
  const input = fs.createReadStream(meta.filePath, { start: 0, end: 64 * 1024 - 1 });
  const chunks: Buffer[] = [];
  for await (const chunk of input) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return csvDelimiter(
    iconv.decode(Buffer.concat(chunks), meta.encoding === "windows-1251" ? "win1251" : "utf8"),
  );
}

export type UploadMeta = {
  tempFileId: string;
  filePath: string;
  filename: string;
  format: "csv" | "xlsx" | "xls";
  headers: string[];
  mapping: PriceColumnMapping;
  delimiter: string;
  encoding: string;
  firstRowHeaders: boolean;
  estimatedRows: number;
  retainForRetry?: boolean;
  safetyWarnings?: string[];
  safetyConfirmationRequired?: boolean;
  deleteMissing?: boolean;
  validationErrors?: string[];
  priceCurrency?: PriceCurrency;
  exchangeRate?: string;
  exchangeRateSource?: "manual";
};
export type ServerSourceFile = {
  warehouseId: string;
  filename: string;
  filePath: string;
  source: string;
};
type WarehouseImportSettings = {
  delimiter?: string;
  encoding?: string;
  firstRowHeaders?: boolean;
  columnMapping?: PriceColumnMapping;
  deleteMissing?: boolean;
  priceCurrency?: PriceCurrency;
};
async function readMeta(id: string, context: AdminRequestContext): Promise<UploadMeta> {
  const bucket = context.adminRuntime?.bindings?.IMPORTS_BUCKET;
  if (bucket) {
    const object = await bucket.get(`imports/${path.basename(id)}.json`);
    if (!object) throw new Error("Файл предпросмотра истёк или не найден");
    return JSON.parse(await object.text()) as UploadMeta;
  }
  const blobMeta = await getVercelBlob(`imports/${path.basename(id)}.json`).catch(() => null);
  if (blobMeta && blobMeta.statusCode === 200)
    return JSON.parse(await new Response(blobMeta.stream).text()) as UploadMeta;
  const metaPath = path.join(STORAGE_DIR, `${path.basename(id)}.json`);
  return JSON.parse(await fsp.readFile(metaPath, "utf8")) as UploadMeta;
}
async function writeMeta(
  id: string,
  meta: UploadMeta,
  context: AdminRequestContext,
): Promise<void> {
  const bucket = context.adminRuntime?.bindings?.IMPORTS_BUCKET;
  if (bucket) {
    await bucket.put(`imports/${id}.json`, JSON.stringify(meta));
    return;
  }
  if (isBlobPath(meta.filePath)) {
    const { put } = await import("@vercel/blob");
    await put(`imports/${id}.json`, JSON.stringify(meta), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
    return;
  }
  await fsp.writeFile(
    path.join(STORAGE_DIR, `${path.basename(id)}.json`),
    JSON.stringify(meta),
    "utf8",
  );
}

export async function importStream(
  meta: UploadMeta,
  context: AdminRequestContext,
): Promise<Readable> {
  if (isBlobPath(meta.filePath)) {
    return getVercelBlobStream(blobPath(meta.filePath));
  }
  if (!meta.filePath.startsWith("r2://")) return fs.createReadStream(meta.filePath);
  const bucket = context.adminRuntime?.bindings?.IMPORTS_BUCKET;
  const object = await bucket?.get(meta.filePath.slice(5));
  if (!object) throw new Error("Загруженный файл не найден в хранилище");
  return Readable.fromWeb(object.body as import("node:stream/web").ReadableStream);
}
async function warehouseSettings(
  client: Client,
  warehouseId: string,
): Promise<{
  name: string;
  supplierId: string | null;
  supplierName: string | null;
  settings: WarehouseImportSettings;
}> {
  const result = await client.query<{
    name: string;
    supplier_id: string | null;
    supplier_name: string | null;
    import_settings: WarehouseImportSettings | null;
    price_currency: PriceCurrency | null;
  }>(
    `SELECT w.name, w.supplier_id::text, s.name AS supplier_name, w.import_settings, w.price_currency FROM warehouses w LEFT JOIN suppliers s ON s.id=w.supplier_id WHERE w.id=$1 AND w.is_active=true`,
    [warehouseId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Активный склад не найден");
  return {
    name: row.name,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    settings: row.price_currency
      ? { ...(row.import_settings ?? {}), priceCurrency: row.price_currency }
      : (row.import_settings ?? {}),
  };
}

async function importSafetyWarnings(
  client: Client,
  warehouseId: string,
  estimatedRows: number,
): Promise<string[]> {
  const previous = await client.query<{ rows_total: string }>(
    `SELECT rows_total::text FROM import_runs
     WHERE warehouse_id=$1 AND status IN ('completed','completed_with_errors')
     ORDER BY finished_at DESC NULLS LAST, id DESC LIMIT 1`,
    [warehouseId],
  );
  const previousRows = Number(previous.rows[0]?.rows_total ?? 0);
  if (previousRows < 100 || estimatedRows < 1) return [];
  const ratio = estimatedRows / previousRows;
  if (ratio < 0.5 || ratio > 2)
    return [
      `Количество строк значительно отличается от предыдущего импорта: было ${previousRows.toLocaleString("ru-RU")}, сейчас ${estimatedRows.toLocaleString("ru-RU")}.`,
    ];
  return [];
}

async function writeImportAudit(
  client: Client,
  runId: string | null,
  username: string,
  action: string,
  payload: unknown,
): Promise<void> {
  await client.query(
    `INSERT INTO import_admin_audit(import_run_id,action,username,payload) VALUES($1,$2,$3,$4::jsonb)`,
    [runId, action, username, JSON.stringify(payload ?? {})],
  );
}

/** Queue a file obtained by an automated source through the same importer used by manual uploads. */
export async function queueServerSourceImport(
  sourceFile: ServerSourceFile,
  context: AdminRequestContext,
): Promise<string> {
  const client = await db(context);
  try {
    const warehouse = await warehouseSettings(client, sourceFile.warehouseId);
    const format = detectPriceFormat(sourceFile.filename);
    if (format !== "csv" && format !== "xlsx" && format !== "xls")
      throw new Error("Поддерживаются CSV, XLSX и XLS");
    const settings = warehouse.settings;
    const priceCurrency = settings.priceCurrency;
    if (!priceCurrency) throw new Error("Укажите валюту прайс-листа для склада");
    const exchangeRate = await resolveExchangeRate(context, priceCurrency);
    const meta: UploadMeta = {
      tempFileId: `src_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      filePath: sourceFile.filePath,
      filename: safeName(sourceFile.filename),
      format,
      headers: [],
      mapping: settings.columnMapping ?? {},
      delimiter: delimiterFor(settings.delimiter),
      encoding: settings.encoding ?? "utf-8",
      firstRowHeaders: settings.firstRowHeaders ?? true,
      estimatedRows: 0,
      retainForRetry: true,
      deleteMissing: settings.deleteMissing === true,
      priceCurrency,
      exchangeRate,
      exchangeRateSource: "manual",
    };
    const preview = await previewFile(meta, context);
    meta.estimatedRows = preview.estimatedRows;
    meta.validationErrors = preview.errors;
    meta.safetyWarnings = await importSafetyWarnings(
      client,
      sourceFile.warehouseId,
      meta.estimatedRows,
    );
    if (meta.estimatedRows > 10_000_000)
      meta.safetyWarnings.push(
        "Файл содержит более 10 миллионов строк и требует дополнительной проверки.",
      );
    if (preview.errors.length) {
      await client.query(
        `INSERT INTO import_runs(filename,source,status,warehouse_id,supplier_id,rows_total,started_by,source_file_path,summary,finished_at)
         VALUES($1,$2,'failed',$3,$4,$5,'system:auto-update',$6,$7,now())`,
        [
          meta.filename,
          sourceFile.source,
          sourceFile.warehouseId,
          warehouse.supplierId,
          meta.estimatedRows,
          sourceFile.filePath,
          preview.errors.join("; "),
        ],
      );
      throw new Error(preview.errors.join("; "));
    }
    if (meta.safetyWarnings.length) {
      await client.query(
        `INSERT INTO import_runs(filename,source,status,warehouse_id,supplier_id,rows_total,started_by,source_file_path,safety_warnings,summary,finished_at)
         VALUES($1,$2,'failed',$3,$4,$5,'system:auto-update',$6,$7::jsonb,$8,now())`,
        [
          meta.filename,
          sourceFile.source,
          sourceFile.warehouseId,
          warehouse.supplierId,
          meta.estimatedRows,
          sourceFile.filePath,
          JSON.stringify(meta.safetyWarnings),
          meta.safetyWarnings.join(" "),
        ],
      );
      throw new Error(meta.safetyWarnings.join(" "));
    }
    const result = await client.query<{ id: string }>(
      `INSERT INTO import_runs(filename,source,status,warehouse_id,supplier_id,column_mapping,rows_total,started_by,source_file_path,price_currency,exchange_rate,exchange_rate_source,source_metadata,safety_warnings,safety_confirmed_at)
       VALUES($1,$2,'queued',$3,$6,$4::jsonb,$5,'system:auto-update',$7,$11,$12::numeric,'manual',$8::jsonb,$9::jsonb,CASE WHEN $10 THEN now() ELSE NULL END) RETURNING id::text`,
      [
        meta.filename,
        sourceFile.source,
        sourceFile.warehouseId,
        JSON.stringify(meta.mapping),
        meta.estimatedRows,
        warehouse.supplierId,
        sourceFile.filePath,
        JSON.stringify({
          format: meta.format,
          encoding: meta.encoding,
          delimiter: meta.delimiter,
          headers: meta.headers,
          firstRowHeaders: meta.firstRowHeaders,
          mapping: meta.mapping,
          tempFileId: meta.tempFileId,
          deleteMissing: meta.deleteMissing === true,
          safetyWarnings: meta.safetyWarnings ?? [],
          validationErrors: meta.validationErrors ?? [],
          priceCurrency,
          exchangeRate,
          exchangeRateSource: "manual",
        }),
        JSON.stringify(meta.safetyWarnings ?? []),
        (meta.safetyWarnings ?? []).length === 0,
        priceCurrency,
        exchangeRate,
      ],
    );
    const runId = result.rows[0]?.id;
    if (!runId) throw new Error("Не удалось создать импорт");
    const { createProcessingSnapshot } = await import("@/lib/import-jobs");
    await createProcessingSnapshot(client, runId, {
      warehouseId: sourceFile.warehouseId,
      supplierId: warehouse.supplierId,
      filename: meta.filename,
      sourceFilePath: meta.filePath,
      format: meta.format,
      headers: meta.headers,
      mapping: meta.mapping,
      delimiter: meta.delimiter,
      encoding: meta.encoding,
      firstRowHeaders: meta.firstRowHeaders,
      deleteMissing: meta.deleteMissing === true,
      priceCurrency,
      exchangeRate,
      exchangeRateSource: "manual",
      startedBy: "system:auto-update",
      estimatedRows: meta.estimatedRows,
    });
    return runId;
  } finally {
    await client.end();
  }
}

async function writeRequestBody(
  request: Request,
  filePath: string,
  maxBytes: number,
  context: AdminRequestContext,
): Promise<number> {
  if (!request.body) throw new Error("Пустое тело загрузки");
  const bucket = context.adminRuntime?.bindings?.IMPORTS_BUCKET;
  if (bucket) {
    let bytes = 0;
    const limited = request.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          bytes += chunk.byteLength;
          if (bytes > maxBytes) throw new Response("Файл превышает лимит 250 МБ", { status: 413 });
          controller.enqueue(chunk);
        },
      }),
    );
    await bucket.put(filePath.slice(5), limited);
    return bytes;
  }
  const reader = request.body.getReader();
  const output = fs.createWriteStream(filePath, { flags: "wx" });
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Response("Файл превышает лимит 250 МБ", { status: 413 });
      if (!output.write(Buffer.from(value)))
        await new Promise<void>((resolve, reject) => {
          output.once("drain", resolve);
          output.once("error", reject);
        });
    }
    await new Promise<void>((resolve, reject) => {
      output.once("finish", resolve);
      output.once("error", reject);
      output.end();
    });
    return bytes;
  } catch (error) {
    reader.cancel().catch(() => undefined);
    output.destroy();
    await fsp.unlink(filePath).catch(() => undefined);
    throw error;
  }
}

async function updateProgress(client: Client, runId: string, counters: Counters): Promise<void> {
  await client.query(
    `UPDATE import_runs SET rows_total=$2,rows_processed=$3,rows_created=$4,rows_updated=$5,rows_skipped=$6,rows_duplicate=$7,error_count=$8 WHERE id=$1`,
    [
      runId,
      counters.rowsTotal,
      counters.rowsProcessed,
      counters.rowsCreated,
      counters.rowsUpdated,
      counters.rowsSkipped,
      counters.rowsDuplicate,
      counters.errorCount,
    ],
  );
}

async function previewFile(
  meta: UploadMeta,
  context: AdminRequestContext,
): Promise<{ rows: string[][]; errors: string[]; estimatedRows: number }> {
  const rows: string[][] = [];
  let estimatedRows = 0;
  const bucket = context.adminRuntime?.bindings?.IMPORTS_BUCKET;
  const objectKey = meta.filePath.startsWith("r2://") ? meta.filePath.slice(5) : null;
  const getStream = async () => {
    if (isBlobPath(meta.filePath)) return getVercelBlobStream(blobPath(meta.filePath));
    if (!objectKey || !bucket) return fs.createReadStream(meta.filePath);
    const object = await bucket.get(objectKey);
    if (!object) throw new Error("Загруженный файл не найден в хранилище");
    return Readable.fromWeb(object.body as import("node:stream/web").ReadableStream);
  };
  if (meta.format === "xlsx") {
    for await (const row of streamXlsxRows(getStream)) {
      estimatedRows += 1;
      if (rows.length < PREVIEW_ROWS + 1)
        rows.push(row.values.slice(1).map((cell) => excelCellText(cell)));
    }
    estimatedRows = Math.max(0, estimatedRows - (meta.firstRowHeaders ? 1 : 0));
  } else if (meta.format === "xls") {
    let workbookInput: ArrayBuffer | string;
    if (isBlobPath(meta.filePath)) {
      workbookInput = await getVercelBlobArrayBuffer(blobPath(meta.filePath));
      if (workbookInput.byteLength > MAX_LEGACY_XLS_BYTES)
        throw new Error("XLS-файл больше 50 МБ: используйте XLSX или CSV для потокового импорта");
    } else if (!meta.filePath.startsWith("r2://")) {
      const fileSize = (await fsp.stat(meta.filePath)).size;
      if (fileSize > MAX_LEGACY_XLS_BYTES)
        throw new Error("XLS-файл больше 50 МБ: используйте XLSX или CSV для потокового импорта");
      workbookInput = meta.filePath;
    } else {
      const object = await bucket?.get(objectKey ?? "");
      const fileSize = Number((object as { size?: number } | null)?.size ?? 0);
      if (fileSize > MAX_LEGACY_XLS_BYTES)
        throw new Error("XLS-файл больше 50 МБ: используйте XLSX или CSV для потокового импорта");
      workbookInput = (await object?.arrayBuffer()) ?? new ArrayBuffer(0);
    }
    const workbook =
      typeof workbookInput === "string"
        ? XLSX.readFile(workbookInput, { sheetRows: PREVIEW_ROWS + 1, raw: false })
        : XLSX.read(workbookInput, {
            type: "array",
            sheetRows: PREVIEW_ROWS + 1,
            raw: false,
          });
    const sheet = workbook.Sheets[workbook.SheetNames[0] ?? ""];
    if (!sheet) throw new Error("В Excel-файле нет листов");
    const range = legacySheetInfo(sheet);
    if (!range) throw new Error("В Excel-файле нет строк");
    for (
      let rowNumber = range.s.r;
      rowNumber <= Math.min(range.e.r, range.s.r + PREVIEW_ROWS);
      rowNumber += 1
    )
      rows.push(legacySheetRow(sheet, range, rowNumber));
    estimatedRows = Math.max(0, range.e.r - range.s.r + 1 - (meta.firstRowHeaders ? 1 : 0));
  } else {
    const delimiter = meta.delimiter || (await detectCsvDelimiter(meta, context));
    meta.delimiter = delimiter;
    const input = (await getStream()).pipe(
      iconv.decodeStream(meta.encoding === "windows-1251" ? "win1251" : "utf8"),
    );
    const parser = input.pipe(
      parseCsv({ delimiter, headers: false, ignoreEmpty: true, trim: true }),
    );
    for await (const parsed of parser) {
      estimatedRows += 1;
      if (rows.length < PREVIEW_ROWS + 1) rows.push((parsed as string[]).map(String));
    }
    estimatedRows = Math.max(0, estimatedRows - (meta.firstRowHeaders ? 1 : 0));
  }
  const headers = meta.firstRowHeaders ? (rows[0] ?? []) : [];
  meta.headers = headers;
  if (meta.firstRowHeaders) {
    const detected = detectPriceColumns(headers, meta.mapping);
    meta.mapping = { ...detected, ...meta.mapping };
  }
  const dataRows = rows.slice(meta.firstRowHeaders ? 1 : 0);
  const errors: string[] = [];
  for (const field of REQUIRED)
    if (!meta.mapping[field])
      errors.push(`Не найдено обязательное поле «${field === "article" ? "Артикул" : "Бренд"}».`);
  if (!meta.mapping["price"] && !meta.mapping["stock"])
    errors.push("Нужно настроить хотя бы цену или наличие.");
  if (!dataRows.length) errors.push("В файле нет строк с данными.");
  return { rows, errors, estimatedRows };
}

function valueAt(row: string[], headers: string[], field: string | undefined): string {
  if (!field) return "";
  const headerIndex = headers.findIndex(
    (header) => header.trim().toLowerCase() === field.trim().toLowerCase(),
  );
  if (headerIndex >= 0) return row[headerIndex] ?? "";
  if (/^\d+$/.test(field)) return row[Number(field) - 1] ?? "";
  if (/^[A-Za-z]{1,3}$/.test(field)) {
    let index = 0;
    for (const c of field.toUpperCase()) index = index * 26 + c.charCodeAt(0) - 64;
    return row[index - 1] ?? "";
  }
  const index = headers.findIndex(
    (header) => header.trim().toLowerCase() === field.trim().toLowerCase(),
  );
  return index >= 0 ? (row[index] ?? "") : "";
}

export type Counters = {
  rowsTotal: number;
  rowsProcessed: number;
  rowsCreated: number;
  rowsUpdated: number;
  rowsSkipped: number;
  rowsDuplicate: number;
  errorCount: number;
};
async function saveError(
  client: Client,
  runId: string,
  rowNumber: number,
  code: string,
  message: string,
  rawValue: string,
): Promise<void> {
  await client.query(
    `INSERT INTO import_errors (import_run_id,row_number,code,message,raw_value,raw_data) VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
    [runId, rowNumber, code, message, rawValue, JSON.stringify({ value: rawValue })],
  );
}

export async function processRow(
  client: Client,
  runId: string,
  warehouseId: string,
  supplierId: string | null,
  headers: string[],
  mapping: PriceColumnMapping,
  row: string[],
  rowNumber: number,
  seen: Set<string>,
  counters: Counters,
  priceCurrency: PriceCurrency,
  exchangeRate: string,
): Promise<void> {
  counters.rowsProcessed += 1;
  const articleRaw = valueAt(row, headers, mapping["article"]);
  const brandRaw = valueAt(row, headers, mapping["brand"]);
  const article = normalizeArticle(articleRaw);
  const brand = normalizeBrand(brandRaw);
  if (!article) {
    counters.rowsSkipped += 1;
    counters.errorCount += 1;
    await saveError(client, runId, rowNumber, "EMPTY_ARTICLE", "Артикул не указан", articleRaw);
    return;
  }
  if (!brand) {
    counters.rowsSkipped += 1;
    counters.errorCount += 1;
    await saveError(client, runId, rowNumber, "EMPTY_BRAND", "Бренд не указан", brandRaw);
    return;
  }
  const key = `${brand}:${article}`;
  if (seen.has(key)) {
    counters.rowsDuplicate += 1;
    counters.rowsSkipped += 1;
    return;
  }
  seen.add(key);
  const priceRaw = valueAt(row, headers, mapping["price"]);
  const stockRaw = valueAt(row, headers, mapping["stock"]);
  const supplierArticleRaw = valueAt(row, headers, mapping["supplier_article"]) || articleRaw;
  const leadTimeRaw = valueAt(row, headers, mapping["lead_time"]);
  const oemRaw = valueAt(row, headers, mapping["oem"]);
  const price = mapping["price"] ? numberValue(priceRaw) : "0.00";
  const stock = mapping["stock"] ? (stockRaw.trim() ? stockValue(stockRaw) : 0) : 0;
  const leadTime = leadTimeRaw ? leadTimeValue(leadTimeRaw) : null;
  if (mapping["price"] && price === null) {
    counters.rowsSkipped += 1;
    counters.errorCount += 1;
    await saveError(client, runId, rowNumber, "INVALID_PRICE", "Некорректная цена", priceRaw);
    return;
  }
  if (mapping["stock"] && stock === null) {
    counters.rowsSkipped += 1;
    counters.errorCount += 1;
    await saveError(client, runId, rowNumber, "INVALID_STOCK", "Некорректный остаток", stockRaw);
    return;
  }
  if (leadTimeRaw && leadTime === null) {
    counters.rowsSkipped += 1;
    counters.errorCount += 1;
    await saveError(
      client,
      runId,
      rowNumber,
      "INVALID_LEAD_TIME",
      "Некорректный срок поставки",
      leadTimeRaw,
    );
    return;
  }
  const name = valueAt(row, headers, mapping["name"]) || String(brandRaw) + " " + articleRaw;
  await client.query("SAVEPOINT import_row");
  try {
    await client.query(
      `INSERT INTO brands (name) VALUES ($1) ON CONFLICT (normalized_name) DO NOTHING`,
      [brandRaw],
    );
    const brandResult = await client.query<{ id: string }>(
      `SELECT id::text FROM brands WHERE normalized_name=$1`,
      [brand],
    );
    const brandId = brandResult.rows[0]?.id;
    if (!brandId) throw new Error("Не удалось определить бренд");
    await client.query(
      `INSERT INTO articles (brand_id,article) VALUES ($1,$2) ON CONFLICT (brand_id,normalized_article) DO UPDATE SET article=EXCLUDED.article`,
      [brandId, articleRaw],
    );
    const articleResult = await client.query<{ id: string }>(
      `SELECT id::text FROM articles WHERE brand_id=$1 AND normalized_article=$2`,
      [brandId, article],
    );
    const articleId = articleResult.rows[0]?.id;
    if (!articleId) throw new Error("Не удалось определить артикул");
    const product = await client.query<{ id: string; is_new: boolean }>(
      `INSERT INTO products (brand_id,article_id,article,name,price,stock,warehouse_id,supplier_id,status) VALUES ($1,$2,$3,$4,ROUND($5::numeric*$9::numeric,2),$6,$7,$8,'active') ON CONFLICT (brand_id,normalized_article) DO UPDATE SET name=CASE WHEN products.name='' THEN EXCLUDED.name ELSE products.name END,updated_at=now() RETURNING id::text,(xmax=0) AS is_new`,
      [
        brandId,
        articleId,
        articleRaw,
        name,
        price ?? "0.00",
        stock ?? 0,
        warehouseId,
        supplierId,
        exchangeRate,
      ],
    );
    const productId = product.rows[0]?.id;
    if (!productId) throw new Error("Не удалось сохранить товар");
    if (oemRaw.trim()) {
      const oemValues = oemRaw
        .split(/[;,|\s]+/)
        .map((value) => value.trim())
        .filter(Boolean)
        .slice(0, 20);
      for (const oem of oemValues) {
        const cross = await client.query<{ id: string }>(
          `INSERT INTO cross_numbers (brand_id,article) VALUES ($1,$2) ON CONFLICT (brand_id,normalized_article) DO UPDATE SET article=cross_numbers.article RETURNING id::text`,
          [brandId, oem],
        );
        const crossId = cross.rows[0]?.id;
        if (crossId) {
          await client.query(
            `INSERT INTO product_cross_numbers (product_id,cross_number_id,source) VALUES ($1,$2,'oem') ON CONFLICT DO NOTHING`,
            [productId, crossId],
          );
        }
      }
    }
    await client.query(
      `INSERT INTO warehouse_product_import_keys (warehouse_id,brand_id,normalized_article,product_id,last_import_run_id) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (warehouse_id,brand_id,normalized_article) DO UPDATE SET product_id=EXCLUDED.product_id,last_import_run_id=EXCLUDED.last_import_run_id,updated_at=now()`,
      [warehouseId, brandId, article, productId, runId],
    );
    await client.query(
      `INSERT INTO warehouse_products (warehouse_id,product_id,stock,purchase_price,updated_at) VALUES ($1,$2,$3,ROUND($4::numeric*$5::numeric,2),now()) ON CONFLICT (warehouse_id,product_id) DO UPDATE SET stock=EXCLUDED.stock,purchase_price=EXCLUDED.purchase_price,updated_at=now()`,
      [warehouseId, productId, stock ?? 0, price ?? "0.00", exchangeRate],
    );
    await client.query(
      `INSERT INTO product_offers (product_id,warehouse_id,supplier_id,price,stock,lead_time_days,supplier_article,supplier_price,supplier_currency,exchange_rate,status,updated_at)
       VALUES ($1,$2,$3,ROUND($4::numeric*$9::numeric,2),$5,$6,$7,$4,$8,$9,CASE WHEN $5 > 0 THEN 'active' ELSE 'out_of_stock' END,now())
       ON CONFLICT (product_id,warehouse_id,offer_key) DO UPDATE SET
         price=EXCLUDED.price,stock=EXCLUDED.stock,lead_time_days=EXCLUDED.lead_time_days,
         supplier_article=EXCLUDED.supplier_article,supplier_price=EXCLUDED.supplier_price,supplier_currency=EXCLUDED.supplier_currency,exchange_rate=EXCLUDED.exchange_rate,status=EXCLUDED.status,updated_at=now()`,
      [
        productId,
        warehouseId,
        supplierId,
        price ?? "0.00",
        stock ?? 0,
        leadTime,
        supplierArticleRaw,
        priceCurrency,
        exchangeRate,
      ],
    );
    await client.query(
      `UPDATE products p SET
         stock=(SELECT COALESCE(SUM(stock),0) FROM warehouse_products WHERE product_id=$1),
         price=COALESCE((SELECT o.price FROM product_offers o WHERE o.product_id=$1 AND o.status='active' AND o.stock>0 ORDER BY o.price ASC,o.lead_time_days NULLS LAST,o.updated_at DESC LIMIT 1),
                        (SELECT MIN(purchase_price) FROM warehouse_products WHERE product_id=$1 AND purchase_price>0),p.price),
         warehouse_id=COALESCE((SELECT o.warehouse_id FROM product_offers o WHERE o.product_id=$1 AND o.status='active' AND o.stock>0 ORDER BY o.price ASC,o.lead_time_days NULLS LAST,o.updated_at DESC LIMIT 1),p.warehouse_id),
         supplier_id=COALESCE((SELECT o.supplier_id FROM product_offers o WHERE o.product_id=$1 AND o.status='active' AND o.stock>0 ORDER BY o.price ASC,o.lead_time_days NULLS LAST,o.updated_at DESC LIMIT 1),COALESCE($3,p.supplier_id)),
         updated_at=now() WHERE p.id=$1`,
      [productId, warehouseId, supplierId],
    );
    if (product.rows[0]?.is_new) counters.rowsCreated += 1;
    else counters.rowsUpdated += 1;
    await client.query("RELEASE SAVEPOINT import_row");
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT import_row").catch(() => undefined);
    await client.query("RELEASE SAVEPOINT import_row").catch(() => undefined);
    counters.rowsSkipped += 1;
    counters.errorCount += 1;
    await saveError(
      client,
      runId,
      rowNumber,
      "DB_ERROR",
      error instanceof Error ? error.message : "Ошибка записи",
      articleRaw,
    );
  }
}

export async function executePriceImport(params: {
  runId: string;
  meta: UploadMeta;
  warehouseId: string;
  context: AdminRequestContext;
  startedBy?: string;
}): Promise<void> {
  const client = await db(params.context);
  const started = Date.now();
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
  let retainSourceForRetry = false;
  let batchSize = 0;
  const beginBatch = async () => {
    if (batchSize === 0) await client.query("BEGIN");
  };
  const finishBatch = async () => {
    if (batchSize > 0) {
      await client.query("COMMIT");
      batchSize = 0;
    }
  };
  try {
    const warehouse = await warehouseSettings(client, params.warehouseId);
    const priceCurrency = params.meta.priceCurrency ?? warehouse.settings.priceCurrency;
    if (!priceCurrency) throw new Error("Укажите валюту прайс-листа для склада");
    params.meta.priceCurrency = priceCurrency;
    params.meta.exchangeRate =
      params.meta.exchangeRate ?? (await resolveExchangeRate(params.context, priceCurrency));
    params.meta.exchangeRateSource = "manual";
    await client.query(
      `UPDATE import_runs SET status='running',started_at=now(),warehouse_id=$2,supplier_id=$3,column_mapping=$4::jsonb,started_by=COALESCE(started_by,$5),source_file_path=COALESCE(source_file_path,$6),price_currency=$8,exchange_rate=$9::numeric,exchange_rate_source=$10,source_metadata=COALESCE(source_metadata,$7::jsonb) WHERE id=$1`,
      [
        params.runId,
        params.warehouseId,
        warehouse.supplierId,
        JSON.stringify(params.meta.mapping),
        params.startedBy ?? "system:import",
        params.meta.filePath,
        JSON.stringify({
          format: params.meta.format,
          encoding: params.meta.encoding,
          delimiter: params.meta.delimiter,
          firstRowHeaders: params.meta.firstRowHeaders,
          mapping: params.meta.mapping,
          tempFileId: params.meta.tempFileId,
          deleteMissing: params.meta.deleteMissing === true,
          safetyWarnings: params.meta.safetyWarnings ?? [],
          priceCurrency: params.meta.priceCurrency ?? "UAH",
          exchangeRate: params.meta.exchangeRate ?? "1",
          exchangeRateSource: "manual",
        }),
        params.meta.priceCurrency ?? "UAH",
        params.meta.exchangeRate ?? "1",
        "manual",
      ],
    );
    if (params.meta.format === "xlsx") {
      let headers: string[] = [];
      let first = true;
      counters.rowsTotal = params.meta.estimatedRows;
      await updateProgress(client, params.runId, counters);
      for await (const row of streamXlsxRows(() => importStream(params.meta, params.context))) {
        const cells = row.values.slice(1).map((cell) => excelCellText(cell));
        const rowNumber = row.number;
        if (first && params.meta.firstRowHeaders) {
          headers = cells;
          first = false;
          continue;
        }
        first = false;
        await beginBatch();
        await processRow(
          client,
          params.runId,
          params.warehouseId,
          warehouse.supplierId,
          headers,
          params.meta.mapping,
          cells,
          rowNumber,
          seen,
          counters,
          params.meta.priceCurrency ?? "UAH",
          params.meta.exchangeRate ?? "1",
        );
        batchSize += 1;
        if (batchSize >= 500) await finishBatch();
        if (counters.rowsProcessed % 100 === 0)
          await updateProgress(client, params.runId, counters);
      }
    } else if (params.meta.format === "xls") {
      if (isBlobPath(params.meta.filePath)) {
        const object = await getVercelBlob(blobPath(params.meta.filePath));
        const fileSize = Number((object as { size?: number } | null)?.size ?? 0);
        if (fileSize > MAX_LEGACY_XLS_BYTES)
          throw new Error("XLS-файл больше 50 МБ: используйте XLSX или CSV для потокового импорта");
      } else if (!params.meta.filePath.startsWith("r2://")) {
        const fileSize = (await fsp.stat(params.meta.filePath)).size;
        if (fileSize > MAX_LEGACY_XLS_BYTES)
          throw new Error("XLS-файл больше 50 МБ: используйте XLSX или CSV для потокового импорта");
      } else {
        const object = await params.context.adminRuntime?.bindings?.IMPORTS_BUCKET?.get(
          params.meta.filePath.slice(5),
        );
        const fileSize = Number((object as { size?: number } | null)?.size ?? 0);
        if (fileSize > MAX_LEGACY_XLS_BYTES)
          throw new Error("XLS-файл больше 50 МБ: используйте XLSX или CSV для потокового импорта");
      }
      let workbookInput: ArrayBuffer | string;
      if (isBlobPath(params.meta.filePath)) {
        workbookInput = await getVercelBlobArrayBuffer(blobPath(params.meta.filePath));
        if (workbookInput.byteLength > MAX_LEGACY_XLS_BYTES)
          throw new Error("XLS-файл больше 50 МБ: используйте XLSX или CSV для потокового импорта");
      } else if (params.meta.filePath.startsWith("r2://")) {
        const object = await params.context.adminRuntime?.bindings?.IMPORTS_BUCKET?.get(
          params.meta.filePath.slice(5),
        );
        workbookInput = (await object?.arrayBuffer()) ?? new ArrayBuffer(0);
        if (workbookInput.byteLength > MAX_LEGACY_XLS_BYTES)
          throw new Error("XLS-файл больше 50 МБ: используйте XLSX или CSV для потокового импорта");
      } else {
        const fileSize = (await fsp.stat(params.meta.filePath)).size;
        if (fileSize > MAX_LEGACY_XLS_BYTES)
          throw new Error("XLS-файл больше 50 МБ: используйте XLSX или CSV для потокового импорта");
        workbookInput = params.meta.filePath;
      }
      const workbook =
        typeof workbookInput === "string"
          ? XLSX.readFile(workbookInput, { raw: false })
          : XLSX.read(workbookInput, { type: "array", raw: false });
      const sheet = workbook.Sheets[workbook.SheetNames[0] ?? ""];
      const range = sheet ? legacySheetInfo(sheet) : null;
      const headers =
        params.meta.firstRowHeaders && range ? legacySheetRow(sheet!, range, range.s.r) : [];
      counters.rowsTotal = Math.max(
        0,
        (range ? range.e.r - range.s.r + 1 : 0) - (params.meta.firstRowHeaders ? 1 : 0),
      );
      await updateProgress(client, params.runId, counters);
      if (!range) throw new Error("В Excel-файле нет листов");
      const firstDataRow = range.s.r + (params.meta.firstRowHeaders ? 1 : 0);
      for (let i = firstDataRow; i <= range.e.r; i += 1) {
        const row = legacySheetRow(sheet!, range, i);
        await beginBatch();
        await processRow(
          client,
          params.runId,
          params.warehouseId,
          warehouse.supplierId,
          headers,
          params.meta.mapping,
          row,
          i + 1,
          seen,
          counters,
          params.meta.priceCurrency ?? "UAH",
          params.meta.exchangeRate ?? "1",
        );
        batchSize += 1;
        if (batchSize >= 500) await finishBatch();
        if (counters.rowsProcessed % 100 === 0)
          await updateProgress(client, params.runId, counters);
      }
    } else {
      const raw = await importStream(params.meta, params.context);
      const decoded = raw.pipe(
        iconv.decodeStream(params.meta.encoding === "windows-1251" ? "win1251" : "utf8"),
      );
      const delimiter =
        params.meta.delimiter || (await detectCsvDelimiter(params.meta, params.context));
      const parser = decoded.pipe(
        parseCsv({ delimiter, headers: false, ignoreEmpty: true, trim: true }),
      );
      let headers: string[] = [];
      let line = 0;
      for await (const parsed of parser) {
        line += 1;
        const row = parsed as string[];
        if (line === 1 && params.meta.firstRowHeaders) {
          headers = row;
          counters.rowsTotal = Math.max(0, params.meta.estimatedRows);
          await updateProgress(client, params.runId, counters);
          continue;
        }
        if (!params.meta.estimatedRows) counters.rowsTotal += 1;
        await beginBatch();
        await processRow(
          client,
          params.runId,
          params.warehouseId,
          warehouse.supplierId,
          headers,
          params.meta.mapping,
          row,
          line,
          seen,
          counters,
          params.meta.priceCurrency ?? "UAH",
          params.meta.exchangeRate ?? "1",
        );
        batchSize += 1;
        if (batchSize >= 500) await finishBatch();
        if (counters.rowsProcessed % 100 === 0)
          await updateProgress(client, params.runId, counters);
      }
    }
    await finishBatch();
    const status: ImportStatus = counters.errorCount ? "completed_with_errors" : "completed";
    retainSourceForRetry =
      params.meta.retainForRetry === true && status === "completed_with_errors";
    const duration = Date.now() - started;
    await client.query(
      `UPDATE import_runs SET status=$2,rows_total=$3,rows_processed=$4,rows_created=$5,rows_updated=$6,rows_skipped=$7,rows_duplicate=$8,error_count=$9,finished_at=now(),duration_ms=$10,summary=$11 WHERE id=$1`,
      [
        params.runId,
        status,
        counters.rowsTotal,
        counters.rowsProcessed,
        counters.rowsCreated,
        counters.rowsUpdated,
        counters.rowsSkipped,
        counters.rowsDuplicate,
        counters.errorCount,
        duration,
        `Обработано строк: ${counters.rowsProcessed}`,
      ],
    );
    await client.query(
      `UPDATE warehouses SET last_import_at=now(),last_import_status=$2,updated_at=now() WHERE id=$1`,
      [params.warehouseId, counters.errorCount ? "success_with_errors" : "success"],
    );
    if (params.meta.deleteMissing === true && counters.errorCount === 0) {
      await client.query("BEGIN");
      try {
        await client.query(
          `UPDATE warehouse_products wp SET stock=0, updated_at=now()
         WHERE wp.warehouse_id=$1 AND NOT EXISTS (
           SELECT 1 FROM warehouse_product_import_keys k
           WHERE k.warehouse_id=wp.warehouse_id AND k.product_id=wp.product_id AND k.last_import_run_id=$2
         )`,
          [params.warehouseId, params.runId],
        );
        await client.query(
          `UPDATE product_offers o SET stock=0,status='out_of_stock',updated_at=now()
         WHERE o.warehouse_id=$1 AND NOT EXISTS (
           SELECT 1 FROM warehouse_product_import_keys k
           WHERE k.warehouse_id=o.warehouse_id AND k.product_id=o.product_id AND k.last_import_run_id=$2
         )`,
          [params.warehouseId, params.runId],
        );
        await writeImportAudit(
          client,
          params.runId,
          params.startedBy ?? "system:import",
          "delete_missing_applied",
          {
            warehouseId: params.warehouseId,
            rowsTotal: counters.rowsTotal,
          },
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
    }
  } catch (error) {
    if (batchSize > 0) {
      await client.query("ROLLBACK").catch(() => undefined);
      batchSize = 0;
    }
    retainSourceForRetry = params.meta.retainForRetry === true;
    await client
      .query(
        `UPDATE import_runs SET status='failed',summary=$2,finished_at=now(),duration_ms=$3 WHERE id=$1`,
        [
          params.runId,
          error instanceof Error ? error.message : "Ошибка импорта",
          Date.now() - started,
        ],
      )
      .catch(() => undefined);
    await client
      .query(`UPDATE warehouses SET last_import_status='failed',updated_at=now() WHERE id=$1`, [
        params.warehouseId,
      ])
      .catch(() => undefined);
  } finally {
    await client.end();
    // Metadata is only needed during the upload/preview window. The source
    // file itself is retained server-side when retry is enabled.
    if (isBlobPath(params.meta.filePath)) {
      await deleteVercelBlob(`imports/${params.meta.tempFileId}.json`).catch(() => undefined);
    } else if (params.meta.filePath.startsWith("r2://")) {
      const bucket = params.context.adminRuntime?.bindings?.IMPORTS_BUCKET;
      await bucket?.delete(`imports/${params.meta.tempFileId}.json`).catch(() => undefined);
    } else {
      await fsp
        .unlink(path.join(STORAGE_DIR, `${path.basename(params.meta.tempFileId)}.json`))
        .catch(() => undefined);
    }
    if (!retainSourceForRetry) {
      if (isBlobPath(params.meta.filePath)) {
        await deleteVercelBlob(blobPath(params.meta.filePath)).catch(() => undefined);
      } else if (params.meta.filePath.startsWith("r2://")) {
        const bucket = params.context.adminRuntime?.bindings?.IMPORTS_BUCKET;
        await bucket?.delete(params.meta.filePath.slice(5)).catch(() => undefined);
      } else {
        await fsp.unlink(params.meta.filePath).catch(() => undefined);
      }
    }
  }
}

type ImportRunRow = {
  id: string;
  filename: string;
  status: ImportStatus;
  warehouse_id: string | null;
  warehouse_name: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  source: string | null;
  started_by: string | null;
  retry_of_run_id: string | null;
  safety_warnings: string[] | null;
  rows_total: number | string;
  rows_processed: number | string;
  rows_created: number | string;
  rows_updated: number | string;
  rows_skipped: number | string;
  rows_duplicate: number | string;
  error_count: number | string;
  started_at: Date | null;
  finished_at: Date | null;
  duration_ms: number | string | null;
  summary: string | null;
  column_mapping: PriceColumnMapping | null;
  price_currency: PriceCurrency | null;
  exchange_rate: string | null;
  exchange_rate_source: "manual" | null;
  worker_id: string | null;
  lease_until: Date | string | null;
  heartbeat_at: Date | string | null;
  preparation_worker_id: string | null;
  preparation_lease_until: Date | string | null;
  preparation_heartbeat_at: Date | string | null;
  created_at: Date;
};
function runView(row: ImportRunRow): ImportRun {
  return {
    id: row.id,
    filename: row.filename,
    status: row.status,
    warehouseId: row.warehouse_id,
    warehouseName: row.warehouse_name,
    supplierName: row.supplier_name,
    supplierId: row.supplier_id,
    source: row.source,
    startedBy: row.started_by,
    retryOfRunId: row.retry_of_run_id,
    safetyWarnings: row.safety_warnings ?? [],
    rowsTotal: Number(row.rows_total),
    rowsProcessed: Number(row.rows_processed),
    rowsCreated: Number(row.rows_created),
    rowsUpdated: Number(row.rows_updated),
    rowsSkipped: Number(row.rows_skipped),
    rowsDuplicate: Number(row.rows_duplicate),
    errorCount: Number(row.error_count),
    startedAt: row.started_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
    durationMs: row.duration_ms == null ? null : Number(row.duration_ms),
    summary: row.summary,
    columnMapping: row.column_mapping ?? null,
    priceCurrency: row.price_currency,
    exchangeRate: row.exchange_rate == null ? null : String(row.exchange_rate),
    exchangeRateSource: row.exchange_rate_source,
    workerId: row.worker_id,
    leaseUntil: row.lease_until ? new Date(row.lease_until).toISOString() : null,
    heartbeatAt: row.heartbeat_at ? new Date(row.heartbeat_at).toISOString() : null,
    preparationWorkerId: row.preparation_worker_id,
    preparationLeaseUntil: row.preparation_lease_until
      ? new Date(row.preparation_lease_until).toISOString()
      : null,
    preparationHeartbeatAt: row.preparation_heartbeat_at
      ? new Date(row.preparation_heartbeat_at).toISOString()
      : null,
    createdAt: row.created_at.toISOString(),
  };
}

export async function handleAdminImportApi(
  request: Request,
  context: AdminRequestContext,
): Promise<Response> {
  const auth = await requireAdmin(request, context);
  const url = new URL(request.url);
  const pathname = url.pathname;
  if (pathname === "/api/admin/import/upload" && request.method === "POST") {
    const url = new URL(request.url);
    const warehouseId = url.searchParams.get("warehouseId");
    let filename = "";
    try {
      filename = decodeURIComponent(request.headers.get("x-file-name") ?? "");
    } catch {
      return Response.json({ ok: false, error: "Некорректное имя файла" }, { status: 400 });
    }
    if (!warehouseId || !filename)
      return Response.json({ ok: false, error: "Файл и склад обязательны" }, { status: 400 });
    const format = detectPriceFormat(filename);
    if (format !== "csv" && format !== "xlsx" && format !== "xls")
      return Response.json({ ok: false, error: "Поддерживаются CSV, XLSX и XLS" }, { status: 415 });
    const declaredSize = Number(request.headers.get("content-length") ?? 0);
    if (declaredSize > MAX_UPLOAD_BYTES)
      return Response.json({ ok: false, error: "Файл превышает лимит 250 МБ" }, { status: 413 });
    const generatedId = `imp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const blobPathHeader = request.headers.get("x-blob-path")?.trim();
    const blobMatch = blobPathHeader?.match(/^imports\/(imp_[A-Za-z0-9]+_[^/]+)\.(csv|xlsx|xls)$/i);
    const id = blobMatch?.[1] ?? generatedId;
    const blobPathIsValid = !!blobMatch;
    if (blobPathHeader && !blobPathIsValid)
      return Response.json(
        { ok: false, error: "Недействительный путь загруженного файла" },
        { status: 400 },
      );
    const bucket = context.adminRuntime?.bindings?.IMPORTS_BUCKET;
    if (context.adminRuntime?.cloudflare && !bucket)
      return Response.json(
        { ok: false, error: "Для серверного импорта настройте R2 bucket binding IMPORTS_BUCKET." },
        { status: 503 },
      );
    if (!bucket && !blobPathIsValid) await fsp.mkdir(STORAGE_DIR, { recursive: true });
    const filePath = blobPathIsValid
      ? `${BLOB_PREFIX}${blobPathHeader}`
      : bucket
        ? `r2://imports/${id}_${safeName(filename)}`
        : path.join(STORAGE_DIR, `${id}_${safeName(filename)}`);
    try {
      if (!blobPathIsValid) await writeRequestBody(request, filePath, MAX_UPLOAD_BYTES, context);
    } catch (error) {
      if (error instanceof Response) return error;
      throw error;
    }
    const client = await db(context);
    let retained = false;
    try {
      const warehouse = await warehouseSettings(client, warehouseId);
      const settings = warehouse.settings;
      const meta: UploadMeta = {
        tempFileId: id,
        filePath,
        filename: safeName(filename),
        format,
        headers: [],
        mapping: settings.columnMapping ?? {},
        delimiter: delimiterFor(settings.delimiter),
        encoding: settings.encoding ?? "utf-8",
        firstRowHeaders: settings.firstRowHeaders ?? true,
        estimatedRows: 0,
        retainForRetry: true,
        deleteMissing: settings.deleteMissing === true,
        ...(settings.priceCurrency ? { priceCurrency: settings.priceCurrency } : {}),
      };
      const preview = await previewFile(meta, context);
      meta.estimatedRows = preview.estimatedRows;
      meta.validationErrors = preview.errors;
      meta.safetyWarnings = await importSafetyWarnings(client, warehouseId, meta.estimatedRows);
      if (meta.estimatedRows > 10_000_000)
        meta.safetyWarnings.push(
          "Файл содержит более 10 миллионов строк и требует дополнительной проверки.",
        );
      await writeMeta(id, meta, context);
      retained = true;
      return Response.json({
        ok: true,
        tempFileId: id,
        filename,
        format,
        estimatedRows: preview.estimatedRows,
        rows: preview.rows.slice(0, PREVIEW_ROWS + 1),
        errors: preview.errors,
        safetyWarnings: meta.safetyWarnings,
        validationErrors: meta.validationErrors,
        mapping: meta.mapping,
        warehouse: { id: warehouseId, name: warehouse.name, supplierName: warehouse.supplierName },
      });
    } finally {
      await client.end();
      if (!retained) {
        if (isBlobPath(filePath)) await deleteVercelBlob(blobPath(filePath)).catch(() => undefined);
        else if (bucket) await bucket.delete(filePath.slice(5)).catch(() => undefined);
        else await fsp.unlink(filePath).catch(() => undefined);
      }
    }
  }
  if (pathname === "/api/admin/import/blob-token" && request.method === "POST") {
    try {
      const body = (await request.json()) as {
        type?: string;
        payload?: { pathname?: string; clientPayload?: string | null; multipart?: boolean };
      };
      const pathnameValue = body.payload?.pathname ?? "";
      if (body.type !== "blob.generate-client-token")
        throw new Error("Некорректный запрос загрузки файла");
      if (!/^imports\/imp_[A-Za-z0-9]+_[^/]+\.(csv|xlsx|xls)$/i.test(pathnameValue))
        throw new Error("Недействительное имя объекта импорта");
      if (body.payload?.multipart !== true)
        throw new Error("Для больших файлов требуется multipart upload");
      const { generateClientTokenFromReadWriteToken } = await import("@vercel/blob/client");
      const token = process.env["BLOB_READ_WRITE_TOKEN"];
      if (!token) throw new Error("Vercel Blob не настроен: отсутствует BLOB_READ_WRITE_TOKEN");
      const clientToken = await generateClientTokenFromReadWriteToken({
        token,
        pathname: pathnameValue,
        allowedContentTypes: [
          "text/csv",
          "application/vnd.ms-excel",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "application/octet-stream",
        ],
        maximumSizeInBytes: MAX_UPLOAD_BYTES,
        addRandomSuffix: false,
        allowOverwrite: false,
        validUntil: Date.now() + 60 * 60 * 1000,
      });
      return Response.json({ type: body.type, clientToken });
    } catch (error) {
      return Response.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : "Не удалось подготовить загрузку файла",
        },
        { status: 400 },
      );
    }
  }
  if (pathname === "/api/admin/import/start" && request.method === "POST") {
    const body = (await request.json()) as {
      tempFileId?: string;
      warehouseId?: string;
      confirmSafety?: boolean;
      priceCurrency?: PriceCurrency;
    };
    if (!body.tempFileId || !body.warehouseId)
      return Response.json({ ok: false, error: "Некорректные параметры" }, { status: 400 });
    const meta = await readMeta(body.tempFileId, context);
    if ((meta.validationErrors ?? []).length > 0)
      return Response.json(
        {
          ok: false,
          error: "Файл не прошёл проверку обязательных полей и структуры",
          errors: meta.validationErrors,
        },
        { status: 422 },
      );
    if ((meta.safetyWarnings ?? []).length > 0 && body.confirmSafety !== true)
      return Response.json(
        { ok: false, requiresConfirmation: true, warnings: meta.safetyWarnings },
        { status: 409 },
      );
    if (
      !(
        isBlobPath(meta.filePath) &&
        /^blob:\/\/imports\/imp_[A-Za-z0-9]+_[^/]+\.(csv|xlsx|xls)$/i.test(meta.filePath)
      ) &&
      !(
        meta.filePath.startsWith(STORAGE_DIR) &&
        meta.filePath.includes(path.basename(body.tempFileId))
      ) &&
      !(
        meta.filePath ===
          `r2://imports/${path.basename(body.tempFileId)}_${path.basename(meta.filename)}` &&
        context.adminRuntime?.bindings?.IMPORTS_BUCKET
      )
    )
      return Response.json({ ok: false, error: "Недействительный файл" }, { status: 400 });
    const client = await db(context);
    try {
      const warehouse = await warehouseSettings(client, body.warehouseId);
      const priceCurrency = body.priceCurrency ?? warehouse.settings.priceCurrency;
      if (!priceCurrency)
        return Response.json(
          { ok: false, error: "Укажите валюту прайс-листа для склада" },
          { status: 422 },
        );
      const exchangeRate = await resolveExchangeRate(context, priceCurrency);
      meta.priceCurrency = priceCurrency;
      meta.exchangeRate = exchangeRate;
      meta.exchangeRateSource = "manual";
      const result = await client.query<{ id: string }>(
        `INSERT INTO import_runs(filename,source,status,warehouse_id,supplier_id,column_mapping,started_by,source_file_path,price_currency,exchange_rate,exchange_rate_source,source_metadata,safety_warnings,safety_confirmed_at)
         SELECT $1,'manual_upload','queued',$2,w.supplier_id,$3::jsonb,$4,$5,$8,$9::numeric,'manual',$6::jsonb,$7::jsonb,now()
         FROM warehouses w WHERE w.id=$2 RETURNING id::text`,
        [
          meta.filename,
          body.warehouseId,
          JSON.stringify(meta.mapping),
          auth.username ?? "admin",
          meta.filePath,
          JSON.stringify({
            format: meta.format,
            encoding: meta.encoding,
            delimiter: meta.delimiter,
            headers: meta.headers,
            firstRowHeaders: meta.firstRowHeaders,
            mapping: meta.mapping,
            tempFileId: meta.tempFileId,
            deleteMissing: meta.deleteMissing === true,
            safetyWarnings: meta.safetyWarnings ?? [],
            validationErrors: meta.validationErrors ?? [],
            priceCurrency,
            exchangeRate,
            exchangeRateSource: "manual",
          }),
          JSON.stringify(meta.safetyWarnings ?? []),
          priceCurrency,
          exchangeRate,
        ],
      );
      const runId = result.rows[0]?.id;
      if (!runId) throw new Error("Не удалось создать импорт");
      const { createProcessingSnapshot } = await import("@/lib/import-jobs");
      await createProcessingSnapshot(client, runId, {
        warehouseId: body.warehouseId,
        supplierId: warehouse.supplierId,
        filename: meta.filename,
        sourceFilePath: meta.filePath,
        format: meta.format,
        headers: meta.headers,
        mapping: meta.mapping,
        delimiter: meta.delimiter,
        encoding: meta.encoding,
        firstRowHeaders: meta.firstRowHeaders,
        deleteMissing: meta.deleteMissing === true,
        priceCurrency,
        exchangeRate,
        exchangeRateSource: "manual",
        startedBy: auth.username ?? "admin",
        estimatedRows: meta.estimatedRows,
      });
      await writeImportAudit(client, runId, auth.username ?? "admin", "safety_confirmed", {
        warnings: meta.safetyWarnings ?? [],
        warehouseId: body.warehouseId,
        filename: meta.filename,
      });
      return Response.json({ ok: true, runId });
    } finally {
      await client.end();
    }
  }
  if (pathname === "/api/admin/import/status" && request.method === "GET") {
    const runId = url.searchParams.get("runId");
    if (!runId || !/^\d+$/.test(runId))
      return Response.json({ ok: false, error: "Некорректный runId" }, { status: 400 });
    const client = await db(context);
    try {
      const run = await client.query<ImportRunRow>(
        `SELECT r.*,w.name warehouse_name,s.name supplier_name FROM import_runs r LEFT JOIN warehouses w ON w.id=r.warehouse_id LEFT JOIN suppliers s ON s.id=r.supplier_id WHERE r.id=$1`,
        [runId],
      );
      if (!run.rows[0])
        return Response.json({ ok: false, error: "Импорт не найден" }, { status: 404 });
      const errors = await client.query(
        `SELECT id::text,import_run_id::text, '' filename, NULL::text warehouse_name,row_number,code,message,raw_value,created_at FROM import_errors WHERE import_run_id=$1 ORDER BY row_number,id LIMIT 20`,
        [runId],
      );
      return Response.json({ ok: true, run: runView(run.rows[0]), errors: errors.rows });
    } finally {
      await client.end();
    }
  }
  if (pathname === "/api/admin/import/history" && request.method === "GET") {
    const client = await db(context);
    try {
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 25)));
      const warehouseId = url.searchParams.get("warehouseId");
      const supplierId = url.searchParams.get("supplierId");
      const status = url.searchParams.get("status");
      const filename = url.searchParams.get("filename")?.trim();
      const createdFrom = url.searchParams.get("from");
      const createdTo = url.searchParams.get("to");
      const before = url.searchParams.get("before");
      const values: unknown[] = [];
      const conditions: string[] = [];
      const add = (value: unknown) => {
        values.push(value);
        return `$${values.length}`;
      };
      if (warehouseId && /^\d+$/.test(warehouseId))
        conditions.push(`r.warehouse_id=${add(warehouseId)}`);
      if (supplierId && /^\d+$/.test(supplierId))
        conditions.push(`r.supplier_id=${add(supplierId)}`);
      if (
        status &&
        [
          "queued",
          "preparing",
          "running",
          "completed",
          "completed_with_errors",
          "failed",
          "canceled",
        ].includes(status)
      )
        conditions.push(`r.status=${add(status)}`);
      if (filename) conditions.push(`r.filename ILIKE '%' || ${add(filename)} || '%'`);
      if (createdFrom && /^\d{4}-\d{2}-\d{2}$/.test(createdFrom))
        conditions.push(`r.created_at >= ${add(createdFrom)}::date`);
      if (createdTo && /^\d{4}-\d{2}-\d{2}$/.test(createdTo))
        conditions.push(`r.created_at < (${add(createdTo)}::date + interval '1 day')`);
      if (before) {
        try {
          const decoded = JSON.parse(Buffer.from(before, "base64url").toString("utf8")) as {
            createdAt: string;
            id: string;
          };
          if (decoded.createdAt && /^\d+$/.test(decoded.id)) {
            const createdCursor = add(decoded.createdAt);
            const idCursor = add(decoded.id);
            conditions.push(
              `(r.created_at,r.id) < (${createdCursor}::timestamptz,${idCursor}::bigint)`,
            );
          }
        } catch {
          return Response.json({ ok: false, error: "Некорректный курсор" }, { status: 400 });
        }
      }
      const result = await client.query<ImportRunRow>(
        `SELECT r.*,w.name warehouse_name,s.name supplier_name
         FROM import_runs r LEFT JOIN warehouses w ON w.id=r.warehouse_id LEFT JOIN suppliers s ON s.id=r.supplier_id
         ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
         ORDER BY r.created_at DESC,r.id DESC LIMIT ${limit + 1}`,
        values,
      );
      const hasMore = result.rows.length > limit;
      const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
      const last = rows.at(-1);
      const nextCursor =
        hasMore && last
          ? Buffer.from(
              JSON.stringify({ createdAt: last.created_at.toISOString(), id: last.id }),
            ).toString("base64url")
          : null;
      return Response.json({ ok: true, runs: rows.map(runView), nextCursor });
    } finally {
      await client.end();
    }
  }
  if (pathname === "/api/admin/import/cancel" && request.method === "POST") {
    const body = (await request.json()) as { runId?: string };
    if (!body.runId || !/^\d+$/.test(body.runId))
      return Response.json({ ok: false, error: "Некорректный runId" }, { status: 400 });
    const client = await db(context);
    try {
      await client.query("BEGIN");
      const current = await client.query<{ status: ImportStatus }>(
        `SELECT status FROM import_runs WHERE id=$1 FOR UPDATE`,
        [body.runId],
      );
      const row = current.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return Response.json({ ok: false, error: "Импорт не найден" }, { status: 404 });
      }
      if (row.status === "canceled") {
        await client.query("COMMIT");
        return Response.json({
          ok: true,
          runId: body.runId,
          status: "canceled",
          alreadyCanceled: true,
        });
      }
      if (!["queued", "preparing", "running"].includes(row.status)) {
        await client.query("ROLLBACK");
        return Response.json(
          { ok: false, error: "Завершённый импорт нельзя отменить" },
          { status: 409 },
        );
      }
      await client.query(
        `UPDATE import_runs
            SET status='canceled', finished_at=clock_timestamp(), heartbeat_at=clock_timestamp(),
                preparation_worker_id=NULL, preparation_lease_until=NULL, worker_id=NULL, lease_until=NULL,
                summary=COALESCE(summary,'Отменено пользователем')
          WHERE id=$1 AND status=$2`,
        [body.runId, row.status],
      );
      await client.query("COMMIT");
      return Response.json({ ok: true, runId: body.runId, status: "canceled" });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      await client.end();
    }
  }
  if (pathname === "/api/admin/import/retry" && request.method === "POST") {
    const body = (await request.json()) as { runId?: string };
    if (!body.runId || !/^\d+$/.test(body.runId))
      return Response.json({ ok: false, error: "Некорректный runId" }, { status: 400 });
    const client = await db(context);
    try {
      const source = await client.query<{
        status: ImportStatus;
        filename: string;
        warehouse_id: string;
        supplier_id: string | null;
        rows_total: number | string;
        source_file_path: string | null;
        source_metadata: Record<string, unknown> | null;
        processing_snapshot: Record<string, unknown> | null;
        price_currency: PriceCurrency | null;
        exchange_rate: string | null;
      }>(
        `SELECT status,filename,warehouse_id::text,supplier_id::text,rows_total,source_file_path,source_metadata,processing_snapshot,price_currency,exchange_rate::text FROM import_runs WHERE id=$1`,
        [body.runId],
      );
      const row = source.rows[0];
      if (row && ["queued", "running"].includes(row.status))
        return Response.json({ ok: false, error: "Этот импорт ещё выполняется" }, { status: 409 });
      if (row && !["failed", "completed_with_errors"].includes(row.status))
        return Response.json(
          { ok: false, error: "Повторить можно только импорт с ошибками или неуспешный импорт" },
          { status: 409 },
        );
      if (!row || !row.source_metadata || !row.processing_snapshot)
        return Response.json(
          { ok: false, error: "Для повтора нужен сохранённый snapshot исходного импорта" },
          { status: 409 },
        );
      const snapshot = row.processing_snapshot;
      const warehouseId = String(snapshot["warehouseId"] ?? row.warehouse_id ?? "");
      const supplierId =
        snapshot["supplierId"] === undefined
          ? row.supplier_id
          : (snapshot["supplierId"] as string | null);
      const sourceFilePath = String(snapshot["sourceFilePath"] ?? row.source_file_path ?? "");
      const priceCurrency =
        (snapshot["priceCurrency"] as PriceCurrency | undefined) ?? row.price_currency;
      const exchangeRate = String(snapshot["exchangeRate"] ?? row.exchange_rate ?? "");
      const format = snapshot["format"] as UploadMeta["format"] | undefined;
      const mapping = snapshot["mapping"] as PriceColumnMapping | undefined;
      const delimiter = snapshot["delimiter"];
      const encoding = snapshot["encoding"];
      const firstRowHeaders = snapshot["firstRowHeaders"];
      const deleteMissing = snapshot["deleteMissing"];
      const headers = Array.isArray(snapshot["headers"])
        ? (snapshot["headers"] as string[])
        : Array.isArray(row.source_metadata["headers"])
          ? (row.source_metadata["headers"] as string[])
          : [];
      if (
        !warehouseId ||
        !sourceFilePath ||
        !priceCurrency ||
        !exchangeRate ||
        !format ||
        !mapping ||
        typeof delimiter !== "string" ||
        typeof encoding !== "string" ||
        typeof firstRowHeaders !== "boolean" ||
        typeof deleteMissing !== "boolean"
      )
        return Response.json(
          {
            ok: false,
            error:
              "Повтор невозможен: immutable snapshot не содержит обязательные параметры обработки",
          },
          { status: 409 },
        );
      if (firstRowHeaders && headers.length === 0)
        return Response.json(
          {
            ok: false,
            error: "Повтор невозможен: в исходном snapshot отсутствуют заголовки файла",
          },
          { status: 409 },
        );
      const meta = {
        tempFileId: String(row.source_metadata["tempFileId"] ?? `retry_${Date.now()}`),
        filePath: sourceFilePath,
        filename: row.filename,
        format,
        headers,
        mapping,
        delimiter,
        encoding,
        firstRowHeaders,
        estimatedRows: Number(row.rows_total ?? row.source_metadata["estimatedRows"] ?? 0),
        retainForRetry: true,
        deleteMissing,
        priceCurrency,
        exchangeRate,
        exchangeRateSource: "manual",
        safetyWarnings: Array.isArray(row.source_metadata["safetyWarnings"])
          ? (row.source_metadata["safetyWarnings"] as string[])
          : [],
        validationErrors: Array.isArray(row.source_metadata["validationErrors"])
          ? (row.source_metadata["validationErrors"] as string[])
          : [],
      } satisfies UploadMeta;
      if (!["csv", "xlsx", "xls"].includes(meta.format))
        return Response.json(
          { ok: false, error: "Формат исходного файла не поддерживается" },
          { status: 415 },
        );
      if (isBlobPath(meta.filePath)) {
        const object = await getVercelBlob(blobPath(meta.filePath));
        if (!object)
          return Response.json(
            { ok: false, error: "Файл больше не найден в хранилище" },
            { status: 410 },
          );
      } else if (meta.filePath.startsWith("r2://")) {
        const object = await context.adminRuntime?.bindings?.IMPORTS_BUCKET?.get(
          meta.filePath.slice(5),
        );
        if (!object)
          return Response.json(
            { ok: false, error: "Файл больше не найден в хранилище" },
            { status: 410 },
          );
      } else if (!(await fsp.stat(meta.filePath).catch(() => null))) {
        return Response.json(
          { ok: false, error: "Файл больше не найден на сервере" },
          { status: 410 },
        );
      }
      const result = await client.query<{ id: string }>(
        `INSERT INTO import_runs(filename,source,status,warehouse_id,supplier_id,column_mapping,started_by,source_file_path,price_currency,exchange_rate,exchange_rate_source,source_metadata,retry_of_run_id)
         VALUES($1,'retry','queued',$2,$3,$4::jsonb,$5,$6,$9,$10::numeric,'manual',$7::jsonb,$8) RETURNING id::text`,
        [
          row.filename,
          warehouseId,
          supplierId,
          JSON.stringify(meta.mapping),
          auth.username ?? "admin",
          meta.filePath,
          JSON.stringify(row.source_metadata),
          body.runId,
          meta.priceCurrency ?? "UAH",
          meta.exchangeRate || "1",
        ],
      );
      const runId = result.rows[0]?.id;
      if (!runId) throw new Error("Не удалось создать повторный импорт");
      const { createProcessingSnapshot } = await import("@/lib/import-jobs");
      await createProcessingSnapshot(client, runId, {
        warehouseId,
        supplierId,
        filename: meta.filename,
        sourceFilePath: meta.filePath,
        format: meta.format,
        headers: meta.headers,
        mapping: meta.mapping,
        delimiter: meta.delimiter,
        encoding: meta.encoding,
        firstRowHeaders: meta.firstRowHeaders,
        deleteMissing: meta.deleteMissing === true,
        priceCurrency,
        exchangeRate,
        exchangeRateSource: "manual",
        startedBy: auth.username ?? "admin",
        estimatedRows: meta.estimatedRows,
      });
      await writeImportAudit(client, runId, auth.username ?? "admin", "retry_requested", {
        retryOfRunId: body.runId,
        warehouseId,
      });
      return Response.json({ ok: true, runId });
    } finally {
      await client.end();
    }
  }
  if (pathname === "/api/admin/import/errors/download" && request.method === "GET") {
    const runId = url.searchParams.get("runId");
    if (!runId || !/^\d+$/.test(runId)) return new Response("Некорректный runId", { status: 400 });
    const client = await db(context);
    try {
      const errors = await client.query(
        `SELECT row_number,raw_value,code,message FROM import_errors WHERE import_run_id=$1 ORDER BY row_number,id`,
        [runId],
      );
      const csv = [
        "\uFEFFНомер строки;Значение;Код;Причина",
        ...errors.rows.map((r) =>
          [r.row_number ?? "-", r.raw_value ?? "", r.code, r.message]
            .map((v) => `"${String(v).replace(/"/g, '""')}"`)
            .join(";"),
        ),
      ].join("\r\n");
      return new Response(csv, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="ajex-import-errors-${runId}.csv"`,
        },
      });
    } finally {
      await client.end();
    }
  }
  return Response.json({ ok: false, error: "Маршрут не найден" }, { status: 404 });
}
