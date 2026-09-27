import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import { Client } from "pg";
import { z } from "zod";
import { getAdminRequestStatus, type AdminRequestContext } from "@/lib/admin-auth";

const limitSchema = z.coerce.number().int().min(1).max(100).default(25);
const pageSchema = z.object({
  search: z.string().trim().max(120).optional(),
  sort: z.enum(["name", "updated"]).default("name"),
  cursor: z.string().max(500).optional(),
  limit: limitSchema,
});
const idSchema = z.string().regex(/^\d+$/).max(20);
const cursorSchema = z.object({
  sort: z.enum(["name", "updated"]),
  value: z.string(),
  id: idSchema,
});
const emailSchema = z
  .string()
  .trim()
  .max(320)
  .refine(
    (value) => !value || z.string().email().safeParse(value).success,
    "Укажите корректный email.",
  );
const sourceTypes = ["api", "email", "manual_upload"] as const;
const priceFormats = ["auto", "csv", "xlsx", "xls", "xml", "json", "custom"] as const;

const supplierInput = z.object({
  id: idSchema.optional(),
  name: z.string().trim().min(1).max(200),
  contactName: z.string().trim().max(200).optional().default(""),
  email: emailSchema.optional().default(""),
  phone: z.string().trim().max(80).optional().default(""),
  active: z.boolean().default(true),
});

const importSettingsSchema = z.object({
  delimiter: z.enum(["auto", "comma", "semicolon", "tab"]).default("auto"),
  encoding: z.enum(["utf-8", "windows-1251"]).default("utf-8"),
  firstRowHeaders: z.boolean().default(true),
  deleteMissing: z.boolean().default(false),
  columnMapping: z
    .object({
      article: z.string().trim().max(100).optional().default(""),
      brand: z.string().trim().max(100).optional().default(""),
      name: z.string().trim().max(100).optional().default(""),
      price: z.string().trim().max(100).optional().default(""),
      stock: z.string().trim().max(100).optional().default(""),
      oem: z.string().trim().max(100).optional().default(""),
      weight: z.string().trim().max(100).optional().default(""),
      size: z.string().trim().max(100).optional().default(""),
      image: z.string().trim().max(100).optional().default(""),
      category: z.string().trim().max(100).optional().default(""),
    })
    .catchall(z.string().trim().max(100))
    .default({}),
});

const importSettingsUpdateInput = z.object({
  id: idSchema,
  importSettings: importSettingsSchema,
});

const warehouseInput = z.object({
  id: idSchema.optional(),
  name: z.string().trim().min(1).max(200),
  supplierId: idSchema,
  sourceType: z.enum(sourceTypes),
  email: emailSchema.optional().default(""),
  apiUrl: z
    .string()
    .trim()
    .max(2048)
    .refine(
      (value) => !value || /^https?:\/\//i.test(value),
      "Введите URL, начинающийся с http:// или https://",
    )
    .optional()
    .default(""),
  priceFormat: z.enum(priceFormats).default("auto"),
  isActive: z.boolean().default(true),
  importSettings: importSettingsSchema.default({}),
  apiKey: z.string().max(2000).optional().default(""),
  login: z.string().max(500).optional().default(""),
  password: z.string().max(2000).optional().default(""),
  clearCredentials: z.boolean().default(false),
  autoUpdateEnabled: z.boolean().default(false),
  updateFrequency: z.enum(["hourly", "daily", "weekly"]).default("daily"),
  updateTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .default("03:00"),
  updateTimezone: z.string().trim().max(80).default("UTC"),
  sourceRequestParams: z.record(z.string(), z.unknown()).default({}),
  emailProtocol: z.literal("imap").default("imap"),
  emailFolder: z.string().trim().max(200).default("INBOX"),
  emailFrom: emailSchema.default(""),
  emailSubject: z.string().trim().max(500).default(""),
  emailAttachmentPattern: z.string().trim().max(500).default(""),
  emailAllowedExtensions: z.array(z.enum(["csv", "xlsx", "xls"])).default(["csv", "xlsx", "xls"]),
});

type Cursor = { sort: "name" | "updated"; value: string; id: string };
type SupplierSecretBundle = { apiKey: string; login: string; password: string };
type WarehouseCredentials = SupplierSecretBundle;

function getConnectionString(context: AdminRequestContext): string | undefined {
  return (
    context.adminRuntime?.bindings?.HYPERDRIVE?.connectionString ??
    process.env["POSTGRES_URL"] ??
    process.env["DATABASE_URL"] ??
    process.env["POSTGRES_PRISMA_URL"] ??
    process.env["POSTGRES_URL_NON_POOLING"]
  );
}

async function requireAdmin(context: AdminRequestContext): Promise<void> {
  setResponseHeader("Cache-Control", "private, no-store");
  const status = await getAdminRequestStatus(context);
  if (!status.authenticated || status.role !== "admin") {
    throw new Response("Forbidden", { status: 403 });
  }
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function decodeBase64Url(value: string): Uint8Array {
  const standard = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(standard + "=".repeat((4 - (standard.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function encodeCursor(cursor: Cursor): string {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(cursor)));
}

function decodeCursor(value: string): Cursor | null {
  try {
    const parsed = cursorSchema.safeParse(
      JSON.parse(new TextDecoder().decode(decodeBase64Url(value))),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function getEncryptionSecret(context: AdminRequestContext): string {
  const secret =
    context.adminRuntime?.bindings?.AJEX_CREDENTIALS_KEY ?? process.env["AJEX_CREDENTIALS_KEY"];
  if (!secret) throw new Error("AJEX_CREDENTIALS_KEY is not configured.");
  return secret;
}

async function getEncryptionKey(context: AdminRequestContext): Promise<CryptoKey> {
  const decoded = decodeBase64Url(
    getEncryptionSecret(context).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""),
  );
  if (decoded.length !== 32)
    throw new Error("AJEX_CREDENTIALS_KEY must encode exactly 32 random bytes.");
  return crypto.subtle.importKey("raw", Uint8Array.from(decoded), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

async function encryptCredentials(
  credentials: WarehouseCredentials,
  warehouseId: string,
  context: AdminRequestContext,
): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await getEncryptionKey(context);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: new TextEncoder().encode(`ajex-warehouse:${warehouseId}`),
    },
    key,
    new TextEncoder().encode(JSON.stringify(credentials)),
  );
  return { ciphertext: encodeBase64Url(new Uint8Array(ciphertext)), iv: encodeBase64Url(iv) };
}

async function decryptCredentials(
  ciphertext: string,
  iv: string,
  warehouseId: string,
  context: AdminRequestContext,
): Promise<WarehouseCredentials> {
  const plain = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: Uint8Array.from(decodeBase64Url(iv)),
      additionalData: new TextEncoder().encode(`ajex-warehouse:${warehouseId}`),
    },
    await getEncryptionKey(context),
    Uint8Array.from(decodeBase64Url(ciphertext)),
  );
  return JSON.parse(new TextDecoder().decode(plain)) as WarehouseCredentials;
}

async function openClient(connectionString: string): Promise<Client> {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 5000,
    query_timeout: 15000,
  });
  await client.connect();
  return client;
}

function cursorSql(
  sort: Cursor["sort"],
  alias: "s" | "w",
  cursor: string | undefined,
  params: unknown[],
) {
  const expression = sort === "name" ? `${alias}.name` : `${alias}.updated_at`;
  const direction = sort === "name" ? "ASC" : "DESC";
  if (!cursor) return { expression, direction, clause: "" };
  const decoded = decodeCursor(cursor);
  if (!decoded || decoded.sort !== sort) throw new Response("Invalid cursor", { status: 400 });
  params.push(decoded.value, decoded.id);
  const comparator = direction === "ASC" ? ">" : "<";
  return {
    expression,
    direction,
    clause: `AND (${expression}, ${alias}.id) ${comparator} ($${params.length - 1}::${sort === "name" ? "text" : "timestamptz"}, $${params.length}::bigint)`,
  };
}

export const listAdminSuppliers = createServerFn({ method: "GET" })
  .validator(pageSchema)
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const connectionString = getConnectionString(context);
    if (!connectionString)
      return { configured: false as const, items: [], hasMore: false, nextCursor: null };
    const params: unknown[] = [];
    const cursor = cursorSql(data.sort, "s", data.cursor, params);
    const filters: string[] = [];
    if (data.search) {
      params.push(`%${data.search}%`);
      filters.push(`s.name ILIKE $${params.length}`);
    }
    if (cursor.clause) filters.push(cursor.clause.replace(/^AND /, ""));
    params.push(data.limit + 1);
    const client = await openClient(connectionString);
    try {
      const result = await client.query<{
        id: string;
        name: string;
        contact_name: string | null;
        email: string | null;
        phone: string | null;
        status: string;
        warehouse_count: string;
        updated_at: Date;
      }>(
        `
        SELECT s.id::text, s.name, s.contact_name, s.email, s.phone, s.status,
          (SELECT count(*)::text FROM warehouses w WHERE w.supplier_id = s.id) AS warehouse_count,
          s.updated_at
        FROM suppliers s
        ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
        ORDER BY ${cursor.expression} ${cursor.direction}, s.id ${cursor.direction}
        LIMIT $${params.length}`,
        params,
      );
      const hasMore = result.rows.length > data.limit;
      const items = result.rows.slice(0, data.limit);
      const last = items.at(-1);
      return {
        configured: true as const,
        items,
        hasMore,
        nextCursor:
          hasMore && last
            ? encodeCursor({
                sort: data.sort,
                value: data.sort === "name" ? last.name : last.updated_at.toISOString(),
                id: last.id,
              })
            : null,
      };
    } finally {
      await client.end().catch(() => undefined);
    }
  });

export const saveAdminSupplier = createServerFn({ method: "POST" })
  .validator(supplierInput)
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const connectionString = getConnectionString(context);
    if (!connectionString) return { ok: false as const, message: "Подключите PostgreSQL." };
    const client = await openClient(connectionString);
    try {
      const status = data.active ? "active" : "paused";
      const result = data.id
        ? await client.query(
            `UPDATE suppliers SET name=$2, contact_name=$3, email=$4, phone=$5, status=$6, updated_at=now()
             WHERE id=$1 RETURNING id::text`,
            [
              data.id,
              data.name,
              data.contactName || null,
              data.email || null,
              data.phone || null,
              status,
            ],
          )
        : await client.query(
            `INSERT INTO suppliers (name, contact_name, email, phone, status)
             VALUES ($1,$2,$3,$4,$5) RETURNING id::text`,
            [data.name, data.contactName || null, data.email || null, data.phone || null, status],
          );
      if (!result.rowCount) return { ok: false as const, message: "Поставщик не найден." };
      return { ok: true as const, id: result.rows[0].id as string };
    } catch (error) {
      console.error("Supplier save failed", error);
      return { ok: false as const, message: "Не удалось сохранить поставщика. Проверьте данные." };
    } finally {
      await client.end().catch(() => undefined);
    }
  });

export const listAdminWarehouses = createServerFn({ method: "GET" })
  .validator(pageSchema)
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const connectionString = getConnectionString(context);
    if (!connectionString)
      return { configured: false as const, items: [], hasMore: false, nextCursor: null };
    const params: unknown[] = [];
    const cursor = cursorSql(data.sort, "w", data.cursor, params);
    const filters: string[] = [];
    if (data.search) {
      params.push(`%${data.search}%`);
      filters.push(`(w.name ILIKE $${params.length} OR s.name ILIKE $${params.length})`);
    }
    if (cursor.clause) filters.push(cursor.clause.replace(/^AND /, ""));
    params.push(data.limit + 1);
    const client = await openClient(connectionString);
    try {
      const result = await client.query<{
        id: string;
        name: string;
        supplier_id: string | null;
        supplier_name: string | null;
        source_type: (typeof sourceTypes)[number];
        contact_email: string | null;
        api_url: string | null;
        price_format: (typeof priceFormats)[number];
        is_active: boolean;
        import_settings: z.infer<typeof importSettingsSchema>;
        auto_update_enabled: boolean;
        update_frequency: string;
        update_time: string;
        update_timezone: string;
        next_update_at: Date | null;
        source_last_error: string | null;
        source_request_params: Record<string, string | number | boolean | null>;
        email_protocol: string;
        email_folder: string;
        email_from: string | null;
        email_subject: string | null;
        email_attachment_pattern: string | null;
        email_allowed_extensions: string[];
        has_credentials: boolean;
        last_updated_at: Date | null;
        last_import_at: Date | null;
        last_import_status: string;
        updated_at: Date;
      }>(
        `
        SELECT w.id::text, w.name, w.supplier_id::text, s.name AS supplier_name,
          w.source_type, w.contact_email, w.api_url, w.price_format, w.is_active,
          w.import_settings, (w.source_credentials_ciphertext IS NOT NULL) AS has_credentials,
          w.auto_update_enabled, w.update_frequency, w.update_time, w.update_timezone, w.next_update_at, w.source_last_error,
          w.source_request_params, w.email_protocol, w.email_folder, w.email_from, w.email_subject, w.email_attachment_pattern, w.email_allowed_extensions,
          w.last_updated_at, w.last_import_at, w.last_import_status, w.updated_at
        FROM warehouses w LEFT JOIN suppliers s ON s.id = w.supplier_id
        ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
        ORDER BY ${cursor.expression} ${cursor.direction}, w.id ${cursor.direction}
        LIMIT $${params.length}`,
        params,
      );
      const hasMore = result.rows.length > data.limit;
      const items = result.rows.slice(0, data.limit);
      const last = items.at(-1);
      return {
        configured: true as const,
        items,
        hasMore,
        nextCursor:
          hasMore && last
            ? encodeCursor({
                sort: data.sort,
                value: data.sort === "name" ? last.name : last.updated_at.toISOString(),
                id: last.id,
              })
            : null,
      };
    } finally {
      await client.end().catch(() => undefined);
    }
  });

export const listSupplierOptions = createServerFn({ method: "GET" }).handler(
  async ({ context }) => {
    await requireAdmin(context);
    const connectionString = getConnectionString(context);
    if (!connectionString) return { configured: false as const, items: [] as const };
    const client = await openClient(connectionString);
    try {
      const result = await client.query<{ id: string; name: string }>(
        "SELECT id::text, name FROM suppliers ORDER BY name, id LIMIT 500",
      );
      return { configured: true as const, items: result.rows };
    } finally {
      await client.end().catch(() => undefined);
    }
  },
);

export const saveAdminWarehouse = createServerFn({ method: "POST" })
  .validator(warehouseInput)
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const connectionString = getConnectionString(context);
    if (!connectionString) return { ok: false as const, message: "Подключите PostgreSQL." };
    if (data.sourceType === "api" && !data.apiUrl) {
      return { ok: false as const, message: "Для API-источника укажите API URL." };
    }
    const client = await openClient(connectionString);
    let transactionStarted = false;
    try {
      await client.query("BEGIN");
      transactionStarted = true;
      let id = data.id;
      let previous: WarehouseCredentials = { apiKey: "", login: "", password: "" };
      let previousCiphertext: string | null = null;
      let previousIv: string | null = null;
      if (id) {
        const existing = await client.query<{
          source_credentials_ciphertext: string | null;
          source_credentials_iv: string | null;
        }>(
          "SELECT source_credentials_ciphertext, source_credentials_iv FROM warehouses WHERE id=$1",
          [id],
        );
        if (!existing.rowCount) return { ok: false as const, message: "Склад не найден." };
        previousCiphertext = existing.rows[0]!.source_credentials_ciphertext;
        previousIv = existing.rows[0]!.source_credentials_iv;
        if (previousCiphertext && previousIv && (data.apiKey || data.login || data.password)) {
          previous = await decryptCredentials(previousCiphertext, previousIv, id, context);
        }
      }
      const importSettings = data.importSettings;
      if (id) {
        await client.query(
          `UPDATE warehouses SET supplier_id=$2, name=$3, source_type=$4, contact_email=$5,
            api_url=$6, price_format=$7, is_active=$8, import_settings=$9::jsonb,
            status=$10, auto_update_enabled=$11, update_frequency=$12, update_time=$13::time, update_timezone=$14, source_request_params=$15::jsonb,
            email_protocol=$16, email_folder=$17, email_from=$18, email_subject=$19, email_attachment_pattern=$20, email_allowed_extensions=$21, next_update_at=CASE WHEN $11 THEN COALESCE(next_update_at, now()) ELSE NULL END, updated_at=now() WHERE id=$1`,
          [
            id,
            data.supplierId,
            data.name,
            data.sourceType,
            data.email || null,
            data.apiUrl || null,
            data.priceFormat,
            data.isActive,
            JSON.stringify(importSettings),
            data.isActive ? "active" : "paused",
            data.autoUpdateEnabled,
            data.updateFrequency,
            data.updateTime,
            data.updateTimezone,
            JSON.stringify(data.sourceRequestParams),
            data.emailProtocol,
            data.emailFolder,
            data.emailFrom || null,
            data.emailSubject || null,
            data.emailAttachmentPattern || null,
            data.emailAllowedExtensions,
          ],
        );
      } else {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO warehouses (supplier_id, name, source_type, contact_email, api_url, price_format, is_active, status, import_settings, auto_update_enabled, update_frequency, update_time, update_timezone, source_request_params, email_protocol, email_folder, email_from, email_subject, email_attachment_pattern, email_allowed_extensions, next_update_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12::time,$13,$14::jsonb,$15,$16,$17,$18,$19,$20,CASE WHEN $10 THEN now() ELSE NULL END) RETURNING id::text`,
          [
            data.supplierId,
            data.name,
            data.sourceType,
            data.email || null,
            data.apiUrl || null,
            data.priceFormat,
            data.isActive,
            data.isActive ? "active" : "paused",
            JSON.stringify(importSettings),
            data.autoUpdateEnabled,
            data.updateFrequency,
            data.updateTime,
            data.updateTimezone,
            JSON.stringify(data.sourceRequestParams),
            data.emailProtocol,
            data.emailFolder,
            data.emailFrom || null,
            data.emailSubject || null,
            data.emailAttachmentPattern || null,
            data.emailAllowedExtensions,
          ],
        );
        id = inserted.rows[0]!.id;
      }

      if (id && data.clearCredentials) {
        await client.query(
          "UPDATE warehouses SET source_credentials_ciphertext=NULL, source_credentials_iv=NULL WHERE id=$1",
          [id],
        );
      } else if (id && (data.apiKey.trim() || data.login.trim() || data.password)) {
        const credentials = {
          apiKey: data.apiKey.trim() || previous.apiKey,
          login: data.login.trim() || previous.login,
          password: data.password || previous.password,
        };
        const encrypted = await encryptCredentials(credentials, id, context);
        await client.query(
          "UPDATE warehouses SET source_credentials_ciphertext=$2, source_credentials_iv=$3 WHERE id=$1",
          [id, encrypted.ciphertext, encrypted.iv],
        );
      } else if (id && previousCiphertext && previousIv) {
        await client.query(
          "UPDATE warehouses SET source_credentials_ciphertext=$2, source_credentials_iv=$3 WHERE id=$1",
          [id, previousCiphertext, previousIv],
        );
      }
      await client.query("COMMIT");
      return { ok: true as const, id };
    } catch (error) {
      if (transactionStarted) await client.query("ROLLBACK").catch(() => undefined);
      console.error("Warehouse save failed", error);
      return {
        ok: false as const,
        message:
          error instanceof Error && error.message.includes("AJEX_CREDENTIALS_KEY")
            ? "Добавьте секрет AJEX_CREDENTIALS_KEY, чтобы безопасно хранить API-ключи и пароли."
            : "Не удалось сохранить склад. Проверьте поля и привязку к поставщику.",
      };
    } finally {
      await client.end().catch(() => undefined);
    }
  });

export const saveWarehouseImportSettings = createServerFn({ method: "POST" })
  .validator(importSettingsUpdateInput)
  .handler(async ({ data, context }) => {
    const auth = await getAdminRequestStatus(context);
    await requireAdmin(context);
    const connectionString = getConnectionString(context);
    if (!connectionString) return { ok: false as const, message: "Подключите PostgreSQL." };
    const client = await openClient(connectionString);
    try {
      const result = await client.query(
        `UPDATE warehouses SET import_settings=$2::jsonb, updated_at=now() WHERE id=$1 RETURNING id`,
        [data.id, JSON.stringify(data.importSettings)],
      );
      if (!result.rowCount) return { ok: false as const, message: "Склад не найден." };
      await client.query(
        `INSERT INTO import_admin_audit(import_run_id,action,username,payload)
         VALUES(NULL,$1,$2,$3::jsonb)`,
        [
          "delete_missing_setting_changed",
          auth.authenticated ? auth.username : "admin",
          JSON.stringify({
            warehouseId: data.id,
            deleteMissing: data.importSettings.deleteMissing === true,
          }),
        ],
      );
      return { ok: true as const };
    } catch (error) {
      console.error("Warehouse import settings save failed", error);
      return { ok: false as const, message: "Не удалось сохранить схему импорта." };
    } finally {
      await client.end().catch(() => undefined);
    }
  });
