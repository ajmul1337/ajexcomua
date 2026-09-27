import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { getRequest, setResponseHeader } from "@tanstack/react-start/server";
import type { Client as PgClient } from "pg";
import { z } from "zod";

const COOKIE_NAME = "__Host-ajex-admin";
const DEV_COOKIE_NAME = "ajex-admin-session";
const SESSION_SECONDS = 8 * 60 * 60;
const PASSWORD_ITERATIONS = 600_000;
const encoder = new TextEncoder();

type AdminRecord = {
  username: "admin";
  role: "admin";
  salt: string;
  passwordHash: string;
  iterations: number;
  version: number;
};

type AdminSession = {
  username: "admin";
  role: "admin";
  version: number;
  expiresAt: number;
};

export type WorkerBindings = {
  HYPERDRIVE?: { connectionString: string };
  IMPORTS_BUCKET?: {
    put(
      key: string,
      value: ReadableStream | string | ArrayBuffer | ArrayBufferView,
    ): Promise<unknown>;
    get(key: string): Promise<{
      body: ReadableStream;
      text(): Promise<string>;
      arrayBuffer(): Promise<ArrayBuffer>;
    } | null>;
    delete(key: string): Promise<void>;
  };
  AJEX_CREDENTIALS_KEY?: string;
  ADMIN_SESSION_SECRET?: string;
};

export type AdminRequestContext = {
  adminRuntime?: {
    cloudflare: boolean;
    bindings?: WorkerBindings;
    waitUntil?: (task: Promise<unknown>) => void;
  };
};

function getRequestRuntime(context: AdminRequestContext): {
  cloudflare: boolean;
  bindings?: WorkerBindings;
} {
  return context.adminRuntime ?? { cloudflare: false };
}

const isProduction = createServerOnlyFn((context: AdminRequestContext): boolean => {
  if (
    getRequestRuntime(context).cloudflare ||
    process.env["NODE_ENV"] === "production" ||
    process.env["VERCEL"] === "1" ||
    process.env["VERCEL_ENV"] !== undefined
  )
    return true;
  try {
    const request = getRequest();
    const hostname = new URL(request.url).hostname;
    return (
      request.headers.has("x-vercel-id") ||
      hostname === "vercel.app" ||
      hostname.endsWith(".vercel.app")
    );
  } catch {
    return false;
  }
});

function getSessionSecret(context: AdminRequestContext): string {
  const runtime = getRequestRuntime(context);
  const secret = runtime.bindings?.ADMIN_SESSION_SECRET ?? process.env["ADMIN_SESSION_SECRET"];
  if (secret && secret.length >= 32) return secret;
  if (isProduction(context))
    throw new Error("ADMIN_SESSION_SECRET must contain at least 32 characters in production.");
  return "ajex-local-development-session-secret-change-before-deploy";
}

function getCookieName(context: AdminRequestContext): string {
  return isProduction(context) ? COOKIE_NAME : DEV_COOKIE_NAME;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function derivePasswordHash(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: Uint8Array.from(salt), iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

function hashesMatch(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1)
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return difference === 0;
}

async function createRecord(password: string, version: number): Promise<AdminRecord> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const passwordHash = await derivePasswordHash(password, salt, PASSWORD_ITERATIONS);
  return {
    username: "admin",
    role: "admin",
    salt: bytesToBase64Url(salt),
    passwordHash: bytesToBase64Url(passwordHash),
    iterations: PASSWORD_ITERATIONS,
    version,
  };
}

function getAuthDatabaseUrl(context: AdminRequestContext): string | undefined {
  return (
    getRequestRuntime(context).bindings?.HYPERDRIVE?.connectionString ??
    process.env["POSTGRES_URL"] ??
    process.env["DATABASE_URL"] ??
    process.env["POSTGRES_URL_NON_POOLING"] ??
    process.env["POSTGRES_PRISMA_URL"]
  );
}

type AdminAccountRow = {
  username: "admin";
  role: "admin";
  password_salt: string;
  password_hash: string;
  password_iterations: number;
  version: number;
};

const CREATE_AUTH_TABLES = `
  CREATE TABLE IF NOT EXISTS ajex_admin_accounts (
    id smallint PRIMARY KEY CHECK (id = 1),
    username text NOT NULL CHECK (username = 'admin'),
    role text NOT NULL CHECK (role = 'admin'),
    password_salt text NOT NULL,
    password_hash text NOT NULL,
    password_iterations integer NOT NULL CHECK (password_iterations >= 100000),
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS ajex_admin_login_attempts (
    ip_hash text PRIMARY KEY,
    attempts integer NOT NULL CHECK (attempts >= 0),
    reset_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS ajex_admin_login_attempts_reset_at_idx
    ON ajex_admin_login_attempts (reset_at);
`;

function rowToRecord(row: AdminAccountRow): AdminRecord {
  return {
    username: row.username,
    role: row.role,
    salt: row.password_salt,
    passwordHash: row.password_hash,
    iterations: row.password_iterations,
    version: row.version,
  };
}

async function withAuthDatabase<T>(
  context: AdminRequestContext,
  action: (client: PgClient) => Promise<T>,
): Promise<T> {
  const connectionString = getAuthDatabaseUrl(context);
  if (!connectionString) {
    throw new Error(
      "Set DATABASE_URL, POSTGRES_URL, POSTGRES_PRISMA_URL, or POSTGRES_URL_NON_POOLING for admin authentication.",
    );
  }
  // Keep the PostgreSQL driver behind the server function boundary. This module is
  // also imported by browser routes for the RPC stubs, so a static `pg` import
  // would pull Node's Buffer/process shims into the browser bundle.
  const { Client } = await import("pg");
  const client = new Client({ connectionString, connectionTimeoutMillis: 10_000 });
  await client.connect();
  try {
    await client.query(CREATE_AUTH_TABLES);
    return await action(client);
  } finally {
    await client.end();
  }
}

async function readRecord(context: AdminRequestContext): Promise<AdminRecord | null> {
  return withAuthDatabase(context, async (client) => {
    const result = await client.query<AdminAccountRow>(
      `SELECT username, role, password_salt, password_hash, password_iterations, version
       FROM ajex_admin_accounts WHERE id = 1`,
    );
    const row = result.rows[0];
    return row ? rowToRecord(row) : null;
  });
}

async function writeRecord(record: AdminRecord, context: AdminRequestContext): Promise<void> {
  await withAuthDatabase(context, async (client) => {
    await client.query(
      `INSERT INTO ajex_admin_accounts
        (id, username, role, password_salt, password_hash, password_iterations, version, updated_at)
       VALUES (1, $1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (id) DO UPDATE SET
         username = EXCLUDED.username,
         role = EXCLUDED.role,
         password_salt = EXCLUDED.password_salt,
         password_hash = EXCLUDED.password_hash,
         password_iterations = EXCLUDED.password_iterations,
         version = EXCLUDED.version,
         updated_at = now()`,
      [
        record.username,
        record.role,
        record.salt,
        record.passwordHash,
        record.iterations,
        record.version,
      ],
    );
  });
}

async function getOrCreateRecord(context: AdminRequestContext): Promise<AdminRecord> {
  const existing = await readRecord(context);
  if (existing) return existing;
  const initial = await createRecord("admin", 1);
  await withAuthDatabase(context, async (client) => {
    await client.query(
      `INSERT INTO ajex_admin_accounts
        (id, username, role, password_salt, password_hash, password_iterations, version)
       VALUES (1, $1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO NOTHING`,
      [
        initial.username,
        initial.role,
        initial.salt,
        initial.passwordHash,
        initial.iterations,
        initial.version,
      ],
    );
  });
  const created = await readRecord(context);
  if (!created) throw new Error("Unable to initialize the administrator account in PostgreSQL.");
  return created;
}

async function hashIp(ip: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(ip));
  return bytesToBase64Url(new Uint8Array(digest));
}

async function checkRateLimit(ip: string, context: AdminRequestContext): Promise<boolean> {
  const ipHash = await hashIp(ip);
  return withAuthDatabase(context, async (client) => {
    await client.query(
      "DELETE FROM ajex_admin_login_attempts WHERE reset_at < now() - interval '1 day'",
    );
    const result = await client.query<{ attempts: number }>(
      `INSERT INTO ajex_admin_login_attempts (ip_hash, attempts, reset_at)
       VALUES ($1, 1, now() + interval '15 minutes')
       ON CONFLICT (ip_hash) DO UPDATE SET
         attempts = CASE WHEN ajex_admin_login_attempts.reset_at <= now()
                         THEN 1 ELSE ajex_admin_login_attempts.attempts + 1 END,
         reset_at = CASE WHEN ajex_admin_login_attempts.reset_at <= now()
                         THEN now() + interval '15 minutes'
                         ELSE ajex_admin_login_attempts.reset_at END,
         updated_at = now()
       RETURNING attempts`,
      [ipHash],
    );
    return Number(result.rows[0]?.attempts ?? 0) <= 5;
  });
}

async function clearRateLimit(ip: string, context: AdminRequestContext): Promise<void> {
  const ipHash = await hashIp(ip);
  await withAuthDatabase(context, async (client) => {
    await client.query("DELETE FROM ajex_admin_login_attempts WHERE ip_hash = $1", [ipHash]);
  });
}

async function signSession(session: AdminSession, context: AdminRequestContext): Promise<string> {
  const payload = bytesToBase64Url(encoder.encode(JSON.stringify(session)));
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(getSessionSecret(context)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return `${payload}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

async function verifySession(
  token: string | null,
  context: AdminRequestContext,
): Promise<AdminSession | null> {
  if (!token) return null;
  const [payload, encodedSignature, ...extra] = token.split(".");
  if (!payload || !encodedSignature || extra.length) return null;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(getSessionSecret(context)),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      Uint8Array.from(base64UrlToBytes(encodedSignature)),
      encoder.encode(payload),
    );
    if (!valid) return null;
    const session = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload))) as AdminSession;
    if (
      session.username !== "admin" ||
      session.role !== "admin" ||
      !Number.isInteger(session.version) ||
      !Number.isFinite(session.expiresAt) ||
      session.expiresAt <= Date.now()
    )
      return null;
    const record = await readRecord(context);
    if (!record || record.version !== session.version) return null;
    return session;
  } catch {
    return null;
  }
}

function readSessionCookie(context: AdminRequestContext): string | null {
  const header = getRequest().headers.get("cookie");
  if (!header) return null;
  const cookieName = getCookieName(context);
  for (const cookie of header.split(/;\s*/)) {
    const separator = cookie.indexOf("=");
    if (separator !== -1 && cookie.slice(0, separator) === cookieName)
      return cookie.slice(separator + 1);
  }
  return null;
}

function setSessionCookie(token: string, context: AdminRequestContext): void {
  const secure = isProduction(context) ? "; Secure" : "";
  setResponseHeader(
    "Set-Cookie",
    `${getCookieName(context)}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_SECONDS}${secure}`,
  );
}

function clearSessionCookie(context: AdminRequestContext): void {
  const secure = isProduction(context) ? "; Secure" : "";
  setResponseHeader(
    "Set-Cookie",
    `${getCookieName(context)}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`,
  );
}

async function verifyPassword(password: string, record: AdminRecord): Promise<boolean> {
  const candidate = await derivePasswordHash(
    password,
    base64UrlToBytes(record.salt),
    record.iterations,
  );
  return hashesMatch(candidate, base64UrlToBytes(record.passwordHash));
}

async function createSession(record: AdminRecord, context: AdminRequestContext): Promise<void> {
  const token = await signSession(
    {
      username: record.username,
      role: record.role,
      version: record.version,
      expiresAt: Date.now() + SESSION_SECONDS * 1000,
    },
    context,
  );
  setSessionCookie(token, context);
}

export const getAdminStatus = createServerFn({ method: "GET" }).handler(async ({ context }) => {
  return getAdminRequestStatus(context);
});

export const getAdminRequestStatus = createServerOnlyFn(async (context: AdminRequestContext) => {
  setResponseHeader("Cache-Control", "no-store");
  const session = await verifySession(readSessionCookie(context), context);
  if (!session) return { authenticated: false as const };
  return {
    authenticated: true as const,
    username: session.username,
    role: session.role,
  };
});

export const loginAdmin = createServerFn({ method: "POST" })
  .validator(
    z.object({ username: z.string().min(1).max(80), password: z.string().min(1).max(256) }),
  )
  .handler(async ({ data, context }) => {
    setResponseHeader("Cache-Control", "no-store");
    const request = getRequest();
    const ip =
      request.headers.get("cf-connecting-ip") ??
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      "local";
    if (!(await checkRateLimit(ip, context)))
      return { ok: false as const, message: "Забагато спроб. Спробуйте через 15 хвилин." };
    const record = await getOrCreateRecord(context);
    const passwordIsValid = await verifyPassword(data.password, record);
    if (data.username.trim().toLowerCase() !== record.username || !passwordIsValid) {
      return { ok: false as const, message: "Неправильний логін або пароль." };
    }
    await clearRateLimit(ip, context);
    await createSession(record, context);
    return { ok: true as const };
  });

export const logoutAdmin = createServerFn({ method: "POST" }).handler(async ({ context }) => {
  clearSessionCookie(context);
  return { ok: true as const };
});

export const changeAdminPassword = createServerFn({ method: "POST" })
  .validator(
    z.object({
      currentPassword: z.string().min(1).max(256),
      newPassword: z.string().min(12).max(256),
    }),
  )
  .handler(async ({ data, context }) => {
    setResponseHeader("Cache-Control", "no-store");
    const session = await verifySession(readSessionCookie(context), context);
    if (!session || session.role !== "admin")
      return { ok: false as const, message: "Потрібно увійти як адміністратор." };
    const record = await getOrCreateRecord(context);
    if (!(await verifyPassword(data.currentPassword, record))) {
      return { ok: false as const, message: "Поточний пароль не підходить." };
    }
    const updated = await createRecord(data.newPassword, record.version + 1);
    await writeRecord(updated, context);
    await createSession(updated, context);
    return { ok: true as const };
  });

export async function verifyAdminRequest(
  request: Request,
  context: AdminRequestContext,
): Promise<{ authenticated: boolean; role?: string; username?: string }> {
  const header = request.headers.get("cookie") ?? "";
  const name = isProduction(context) ? COOKIE_NAME : DEV_COOKIE_NAME;
  const value = header
    .split(/;\s*/)
    .find((item) => item.startsWith(name + "="))
    ?.slice(name.length + 1);
  if (!value) return { authenticated: false };
  const [payload, encodedSignature, ...extra] = value.split(".");
  if (!payload || !encodedSignature || extra.length) return { authenticated: false };
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(getSessionSecret(context)),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const signature = new Uint8Array(base64UrlToBytes(encodedSignature));
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      signature as unknown as BufferSource,
      encoder.encode(payload),
    );
    if (!valid) return { authenticated: false };
    const session = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload))) as AdminSession;
    if (session.username !== "admin" || session.role !== "admin" || session.expiresAt <= Date.now())
      return { authenticated: false };
    const record = await readRecord(context);
    if (!record || record.version !== session.version) return { authenticated: false };
    return { authenticated: true, role: session.role, username: session.username };
  } catch {
    return { authenticated: false };
  }
}
