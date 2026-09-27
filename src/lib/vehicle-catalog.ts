import { createServerFn } from "@tanstack/react-start";
import type { Client as PgClient } from "pg";
import { z } from "zod";
import { type AdminRequestContext } from "@/lib/admin-auth";

const id = z.string().regex(/^\d+$/);
const optionsInput = z.object({
  parent: z.enum([
    "makes",
    "models",
    "generations",
    "bodies",
    "engines",
    "modifications",
    "categories",
  ]),
  makeId: id.optional(),
  modelId: id.optional(),
  generationId: id.optional(),
  bodyId: id.optional(),
  engineId: id.optional(),
  modificationId: id.optional(),
  query: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const productsInput = z.object({
  modificationId: id.optional(),
  generationId: id.optional(),
  bodyId: id.optional(),
  engineId: id.optional(),
  modelId: id.optional(),
  categoryId: id.optional(),
  page: z.coerce.number().int().min(1).default(1),
  cursor: z.string().max(300).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
const productCursor = z.object({
  available: z.enum(["0", "1"]),
  price: z.string(),
  id: z.string().regex(/^\d+$/),
});
function decodeProductCursor(value: string | undefined) {
  if (!value) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    const parsed = productCursor.safeParse(decoded);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
function encodeProductCursor(value: z.infer<typeof productCursor>) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
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
async function db(context: AdminRequestContext): Promise<PgClient> {
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

export const listVehicleOptions = createServerFn({ method: "GET" })
  .validator(optionsInput)
  .handler(async ({ data, context }) => {
    const client = await db(context);
    try {
      const q = data.query ? `%${data.query}%` : null;
      const p = data.parent;
      if (p === "makes")
        return {
          items: (
            await client.query(
              `SELECT id::text, name, 'make' AS kind FROM vehicle_makes WHERE ($1::text IS NULL OR name ILIKE $1) ORDER BY name LIMIT $2`,
              [q, data.limit],
            )
          ).rows,
        };
      if (p === "models")
        return {
          items: (
            await client.query(
              `SELECT vm.id::text, vm.name, vm.make_id::text AS parent_id, 'model' AS kind FROM vehicle_models vm WHERE vm.make_id=$1 AND ($2::text IS NULL OR vm.name ILIKE $2) ORDER BY vm.name LIMIT $3`,
              [data.makeId, q, data.limit],
            )
          ).rows,
        };
      if (p === "generations")
        return {
          items: (
            await client.query(
              `SELECT vg.id::text, vg.name, vg.model_id::text AS parent_id, vg.year_from, vg.year_to, 'generation' AS kind FROM vehicle_generations vg WHERE vg.model_id=$1 AND ($2::text IS NULL OR vg.name ILIKE $2) ORDER BY vg.year_from NULLS LAST,vg.name LIMIT $3`,
              [data.modelId, q, data.limit],
            )
          ).rows,
        };
      if (p === "bodies")
        return {
          items: (
            await client.query(
              `SELECT vb.id::text, vb.name, vb.generation_id::text AS parent_id, vb.doors, 'body' AS kind FROM vehicle_bodies vb WHERE vb.generation_id=$1 AND ($2::text IS NULL OR vb.name ILIKE $2) ORDER BY vb.name LIMIT $3`,
              [data.generationId, q, data.limit],
            )
          ).rows,
        };
      if (p === "engines")
        return {
          items: (
            await client.query(
              `SELECT ve.id::text, ve.name, ve.model_id::text AS parent_id, ve.fuel_id::text, ve.displacement_cc, ve.power_kw, vf.name AS fuel, 'engine' AS kind FROM vehicle_engines ve LEFT JOIN vehicle_fuels vf ON vf.id=ve.fuel_id WHERE ve.model_id=$1 AND ($2::text IS NULL OR ve.name ILIKE $2 OR ve.code ILIKE $2) ORDER BY ve.name LIMIT $3`,
              [data.modelId, q, data.limit],
            )
          ).rows,
        };
      if (p === "modifications")
        return {
          items: (
            await client.query(
              `SELECT vm.id::text, vm.name, vm.generation_id::text AS parent_id, vm.body_id::text, vm.engine_id::text, vm.fuel_id::text, vm.year_from, vm.year_to, 'modification' AS kind FROM vehicle_modifications vm WHERE vm.generation_id=$1 AND ($2::text IS NULL OR vm.name ILIKE $2) AND ($3::bigint IS NULL OR vm.body_id=$3) AND ($4::bigint IS NULL OR vm.engine_id=$4) ORDER BY vm.name LIMIT $5`,
              [data.generationId, q, data.bodyId ?? null, data.engineId ?? null, data.limit],
            )
          ).rows,
        };
      return {
        items: (
          await client.query(
            `SELECT id::text, name, slug, 'category' AS kind FROM categories WHERE ($1::text IS NULL OR name ILIKE $1) ORDER BY sort_order,name LIMIT $2`,
            [q, data.limit],
          )
        ).rows,
      };
    } finally {
      await client.end();
    }
  });

async function queryCompatibleVehicleProducts(
  client: PgClient,
  data: z.infer<typeof productsInput>,
) {
  const params: unknown[] = [];
  const add = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  const fitmentClauses = [
    data.modificationId && `vc.modification_id=${add(data.modificationId)}`,
    data.generationId && `vc.generation_id=${add(data.generationId)}`,
    data.bodyId && `vc.body_id=${add(data.bodyId)}`,
    data.engineId && `vc.engine_id=${add(data.engineId)}`,
    data.modelId && `vc.model_id=${add(data.modelId)}`,
  ].filter(Boolean) as string[];
  const category = data.categoryId
    ? `AND (p.category_id=${add(data.categoryId)} OR EXISTS (SELECT 1 FROM product_categories pc WHERE pc.product_id=p.id AND pc.category_id=$${params.length}))`
    : "";
  const cursor = decodeProductCursor(data.cursor);
  if (data.cursor && !cursor) throw new Response("Invalid cursor", { status: 400 });
  let cursorCondition = "";
  if (cursor) {
    const available = add(Number(cursor.available));
    const price = add(cursor.price);
    const cursorId = add(cursor.id);
    cursorCondition = `((p.stock > 0)::int < ${available} OR ((p.stock > 0)::int = ${available} AND (p.price,p.id) > (${price}::numeric,${cursorId}::bigint)))`;
  }
  const fitment = fitmentClauses.filter(Boolean).join(" OR ");
  const limit = add(data.limit + 1);
  const result = await client.query(
    `SELECT DISTINCT p.id::text, b.name AS brand, p.article, p.name, p.price::text, p.stock::text, c.name AS category, p.status FROM vehicle_compatibility vc JOIN products p ON p.id=vc.product_id JOIN brands b ON b.id=p.brand_id LEFT JOIN categories c ON c.id=p.category_id WHERE (${fitment || "TRUE"}) ${cursorCondition ? `AND ${cursorCondition}` : ""} ${category} ORDER BY (p.stock>0) DESC,p.price ASC,p.id LIMIT ${limit}`,
    params,
  );
  const hasMore = result.rows.length > data.limit;
  const items = hasMore ? result.rows.slice(0, data.limit) : result.rows;
  const last = items.at(-1);
  return {
    items,
    page: data.page,
    limit: data.limit,
    hasMore,
    nextCursor:
      hasMore && last
        ? encodeProductCursor({
            available: Number(last.stock) > 0 ? "1" : "0",
            price: last.price,
            id: last.id,
          })
        : null,
  };
}

export const listCompatibleVehicleProducts = createServerFn({ method: "GET" })
  .validator(productsInput)
  .handler(async ({ data, context }) => {
    const client = await db(context);
    try {
      return await queryCompatibleVehicleProducts(client, data);
    } finally {
      await client.end();
    }
  });

export async function handleVehicleCatalogApi(
  request: Request,
  context: AdminRequestContext,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/catalog/vehicle" || request.method !== "GET")
    return Response.json({ ok: false, error: "Маршрут не найден" }, { status: 404 });
  const mode = url.searchParams.get("mode") ?? "options";
  if (mode === "products") {
    const parsed = productsInput.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success)
      return Response.json({ ok: false, error: "Некорректный выбор автомобиля" }, { status: 400 });
    const client = await db(context);
    try {
      const result = await queryCompatibleVehicleProducts(client, parsed.data);
      return Response.json(
        { ok: true, ...result },
        { headers: { "cache-control": "public, max-age=30" } },
      );
    } finally {
      await client.end();
    }
  }
  const parsed = optionsInput.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success)
    return Response.json(
      { ok: false, error: "Укажите уровень каталога и родителя" },
      { status: 400 },
    );
  const client = await db(context);
  try {
    const q = parsed.data.query ? `%${parsed.data.query}%` : null;
    const p = parsed.data.parent;
    const limit = parsed.data.limit;
    let rows;
    if (p === "makes")
      rows = await client.query(
        `SELECT id::text,name,'make' AS kind FROM vehicle_makes WHERE ($1::text IS NULL OR name ILIKE $1) ORDER BY name LIMIT $2`,
        [q, limit],
      );
    else if (p === "models")
      rows = await client.query(
        `SELECT id::text,name,make_id::text AS parent_id,'model' AS kind FROM vehicle_models WHERE make_id=$1 AND ($2::text IS NULL OR name ILIKE $2) ORDER BY name LIMIT $3`,
        [parsed.data.makeId, q, limit],
      );
    else if (p === "generations")
      rows = await client.query(
        `SELECT id::text,name,model_id::text AS parent_id,year_from,year_to,'generation' AS kind FROM vehicle_generations WHERE model_id=$1 AND ($2::text IS NULL OR name ILIKE $2) ORDER BY year_from NULLS LAST,name LIMIT $3`,
        [parsed.data.modelId, q, limit],
      );
    else if (p === "bodies")
      rows = await client.query(
        `SELECT id::text,name,generation_id::text AS parent_id,doors,'body' AS kind FROM vehicle_bodies WHERE generation_id=$1 AND ($2::text IS NULL OR name ILIKE $2) ORDER BY name LIMIT $3`,
        [parsed.data.generationId, q, limit],
      );
    else if (p === "engines")
      rows = await client.query(
        `SELECT ve.id::text,ve.name,ve.model_id::text AS parent_id,ve.displacement_cc,ve.power_kw,vf.name AS fuel,'engine' AS kind FROM vehicle_engines ve LEFT JOIN vehicle_fuels vf ON vf.id=ve.fuel_id WHERE ve.model_id=$1 AND ($2::text IS NULL OR ve.name ILIKE $2 OR ve.code ILIKE $2) ORDER BY ve.name LIMIT $3`,
        [parsed.data.modelId, q, limit],
      );
    else if (p === "modifications")
      rows = await client.query(
        `SELECT id::text,name,generation_id::text AS parent_id,body_id::text,engine_id::text,year_from,year_to,'modification' AS kind FROM vehicle_modifications WHERE generation_id=$1 AND ($2::text IS NULL OR name ILIKE $2) AND ($3::bigint IS NULL OR body_id=$3) AND ($4::bigint IS NULL OR engine_id=$4) ORDER BY name LIMIT $5`,
        [
          parsed.data.generationId,
          q,
          parsed.data.bodyId ?? null,
          parsed.data.engineId ?? null,
          limit,
        ],
      );
    else
      rows = await client.query(
        `SELECT id::text,name,slug,'category' AS kind FROM categories WHERE ($1::text IS NULL OR name ILIKE $1) ORDER BY sort_order,name LIMIT $2`,
        [q, limit],
      );
    return Response.json(
      { ok: true, items: rows.rows },
      { headers: { "cache-control": "public, max-age=60" } },
    );
  } finally {
    await client.end();
  }
}
