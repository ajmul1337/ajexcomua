import { createServerFn } from "@tanstack/react-start";
import type { Client as PgClient } from "pg";
import { z } from "zod";
import { getAdminRequestStatus, type AdminRequestContext } from "@/lib/admin-auth";

export const currencies = ["UAH", "USD", "EUR"] as const;
export type PriceCurrency = (typeof currencies)[number];
export type ExchangeRateSource = "manual";

const rateInput = z.object({
  rates: z.object({
    USD: z
      .string()
      .trim()
      .regex(/^\d+(?:[.,]\d{1,6})?$/),
    EUR: z
      .string()
      .trim()
      .regex(/^\d+(?:[.,]\d{1,6})?$/),
  }),
});

function connectionString(context: AdminRequestContext): string | undefined {
  return (
    context.adminRuntime?.bindings?.HYPERDRIVE?.connectionString ??
    process.env["POSTGRES_URL"] ??
    process.env["DATABASE_URL"] ??
    process.env["POSTGRES_PRISMA_URL"] ??
    process.env["POSTGRES_URL_NON_POOLING"]
  );
}

async function openClient(context: AdminRequestContext): Promise<PgClient> {
  const url = connectionString(context);
  if (!url) throw new Error("PostgreSQL не подключён");
  const { Client } = await import("pg");
  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: 5000,
    query_timeout: 15000,
  });
  await client.connect();
  return client;
}

async function requireAdmin(context: AdminRequestContext): Promise<void> {
  const status = await getAdminRequestStatus(context);
  if (!status.authenticated || status.role !== "admin")
    throw new Response("Forbidden", { status: 403 });
}

function canonicalRate(value: string): string {
  const normalized = value.replace(",", ".");
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric <= 0) throw new Error("Курс должен быть больше нуля");
  return normalized;
}

export async function readExchangeRates(
  context: AdminRequestContext,
): Promise<Record<PriceCurrency, string>> {
  const client = await openClient(context);
  try {
    const result = await client.query<{ currency: PriceCurrency; rate_to_uah: string }>(
      "SELECT currency, rate_to_uah::text FROM exchange_rates WHERE currency IN ('UAH','USD','EUR')",
    );
    const rates: Record<PriceCurrency, string> = { UAH: "1", USD: "43.50", EUR: "51.00" };
    for (const row of result.rows) rates[row.currency] = row.rate_to_uah;
    rates.UAH = "1";
    return rates;
  } finally {
    await client.end().catch(() => undefined);
  }
}

export const listExchangeRates = createServerFn({ method: "GET" }).handler(async ({ context }) => {
  await requireAdmin(context);
  if (!connectionString(context))
    return { configured: false as const, rates: { UAH: "1", USD: "43.50", EUR: "51.00" } };
  return { configured: true as const, rates: await readExchangeRates(context) };
});

export const saveExchangeRates = createServerFn({ method: "POST" })
  .validator(rateInput)
  .handler(async ({ data, context }) => {
    const status = await getAdminRequestStatus(context);
    await requireAdmin(context);
    const client = await openClient(context);
    try {
      const username = status.username ?? "admin";
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO exchange_rates(currency,rate_to_uah,source,updated_at,updated_by) VALUES ('USD',$1::numeric,'manual',now(),$3),('EUR',$2::numeric,'manual',now(),$3) ON CONFLICT(currency) DO UPDATE SET rate_to_uah=EXCLUDED.rate_to_uah,source='manual',updated_at=now(),updated_by=EXCLUDED.updated_by",
        [canonicalRate(data.rates.USD), canonicalRate(data.rates.EUR), username],
      );
      await client.query("COMMIT");
      return { ok: true as const, rates: await readExchangeRates(context) };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      console.error("Exchange rates save failed", error);
      return { ok: false as const, message: "Не удалось сохранить курсы." };
    } finally {
      await client.end().catch(() => undefined);
    }
  });

export async function resolveExchangeRate(
  context: AdminRequestContext,
  currency: PriceCurrency,
): Promise<string> {
  if (currency === "UAH") return "1";
  const rates = await readExchangeRates(context);
  return rates[currency];
}
