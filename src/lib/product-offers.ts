import { createServerFn } from "@tanstack/react-start";
import { Client } from "pg";
import { z } from "zod";
import { getAdminRequestStatus, type AdminRequestContext } from "@/lib/admin-auth";

const endpointSchema = z.object({
  brand: z.string().trim().min(1).max(200),
  article: z.string().trim().min(1).max(200),
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

async function db(context: AdminRequestContext): Promise<Client> {
  const url = connectionString(context);
  if (!url) throw new Error("PostgreSQL не подключён");
  const client = new Client({
    connectionString: url,
    connectionTimeoutMillis: 10_000,
    query_timeout: 30_000,
  });
  await client.connect();
  return client;
}

async function requireAdmin(context: AdminRequestContext): Promise<void> {
  const status = await getAdminRequestStatus(context);
  if (!status.authenticated || status.role !== "admin")
    throw new Response("Forbidden", { status: 403 });
}

export const listAdminProductOffers = createServerFn({ method: "GET" })
  .validator(endpointSchema)
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const client = await db(context);
    try {
      const result = await client.query(
        `
        SELECT p.id::text AS product_id, b.name AS brand, p.article,
          o.id::text AS offer_id, w.id::text AS warehouse_id, w.name AS warehouse,
          s.id::text AS supplier_id, s.name AS supplier, o.price::text, o.stock::text,
          o.lead_time_days, o.supplier_article, o.status, o.updated_at
        FROM products p
        JOIN brands b ON b.id=p.brand_id
        JOIN product_offers o ON o.product_id=p.id
        JOIN warehouses w ON w.id=o.warehouse_id
        LEFT JOIN suppliers s ON s.id=o.supplier_id
        WHERE b.normalized_name=upper(btrim($1))
          AND p.normalized_article=normalize_part_article($2)
        ORDER BY (o.status='active' AND o.stock>0) DESC, o.price ASC, o.updated_at DESC`,
        [data.brand, data.article],
      );
      return { configured: true as const, items: result.rows };
    } finally {
      await client.end();
    }
  });

export const getBestProductOffer = createServerFn({ method: "GET" })
  .validator(endpointSchema)
  .handler(async ({ data, context }) => {
    const client = await db(context);
    try {
      const result = await client.query(
        `
        SELECT o.id::text AS offer_id, p.id::text AS product_id, b.name AS brand, p.article,
          o.price::text, o.stock::text, o.lead_time_days, o.supplier_article,
          w.name AS warehouse, s.name AS supplier, o.updated_at
        FROM products p
        JOIN brands b ON b.id=p.brand_id
        JOIN product_offers o ON o.product_id=p.id
        JOIN warehouses w ON w.id=o.warehouse_id
        LEFT JOIN suppliers s ON s.id=o.supplier_id
        WHERE b.normalized_name=upper(btrim($1))
          AND p.normalized_article=normalize_part_article($2)
          AND o.status='active' AND o.stock>0
        ORDER BY o.price ASC, o.lead_time_days NULLS LAST, o.updated_at DESC
        LIMIT 1`,
        [data.brand, data.article],
      );
      return { offer: result.rows[0] ?? null };
    } finally {
      await client.end();
    }
  });

export async function handleProductOfferApi(
  request: Request,
  context: AdminRequestContext,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/products/offer" || request.method !== "GET")
    return Response.json({ ok: false, error: "Маршрут не найден" }, { status: 404 });
  const parsed = endpointSchema.safeParse({
    brand: url.searchParams.get("brand") ?? "",
    article: url.searchParams.get("article") ?? "",
  });
  if (!parsed.success)
    return Response.json({ ok: false, error: "Бренд и артикул обязательны" }, { status: 400 });
  const client = await db(context);
  try {
    const result = await client.query(
      `
      SELECT o.id::text AS offer_id, p.id::text AS product_id, b.name AS brand, p.article,
        o.price::text, o.stock::text, o.lead_time_days, o.supplier_article, w.name AS warehouse, s.name AS supplier
      FROM products p JOIN brands b ON b.id=p.brand_id JOIN product_offers o ON o.product_id=p.id
      JOIN warehouses w ON w.id=o.warehouse_id LEFT JOIN suppliers s ON s.id=o.supplier_id
      WHERE b.normalized_name=upper(btrim($1)) AND p.normalized_article=normalize_part_article($2)
        AND o.status='active' AND o.stock>0
      ORDER BY o.price ASC,o.lead_time_days NULLS LAST,o.updated_at DESC LIMIT 1`,
      [parsed.data.brand, parsed.data.article],
    );
    return Response.json(
      { ok: true, offer: result.rows[0] ?? null },
      { headers: { "cache-control": "public, max-age=30" } },
    );
  } finally {
    await client.end();
  }
}
