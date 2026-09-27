import { createServerFn } from "@tanstack/react-start";
import { Client } from "pg";
import { z } from "zod";
import { type AdminRequestContext } from "@/lib/admin-auth";

const productInput = z
  .object({
    id: z.string().regex(/^\d+$/).optional(),
    brand: z.string().trim().min(1).max(200).optional(),
    article: z.string().trim().min(1).max(200).optional(),
  })
  .refine((value) => Boolean(value.id || (value.brand && value.article)));

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
    connectionTimeoutMillis: 5000,
    query_timeout: 15000,
  });
  await client.connect();
  return client;
}

async function fetchProduct(data: z.infer<typeof productInput>, context: AdminRequestContext) {
  const client = await db(context);
  try {
    const identityParams = data.id ? [data.id] : [data.brand, data.article];
    const identityWhere = data.id
      ? "p.id=$1"
      : "b.normalized_name=upper(btrim($1)) AND p.normalized_article=normalize_part_article($2)";
    const productResult = await client.query(
      `
      SELECT p.id::text, b.name AS brand, p.article, p.name, p.description,
        COALESCE(best.price, p.price)::text AS price, COALESCE(best.stock, p.stock)::text AS stock,
        p.status, COALESCE(best.warehouse, w.name) AS warehouse, COALESCE(best.supplier, s.name) AS supplier,
        p.image, p.category_id::text, c.name AS category
      FROM products p JOIN brands b ON b.id=p.brand_id LEFT JOIN warehouses w ON w.id=p.warehouse_id
      LEFT JOIN suppliers s ON s.id=p.supplier_id LEFT JOIN categories c ON c.id=p.category_id
      LEFT JOIN LATERAL (
        SELECT o.price, o.stock, ow.name AS warehouse, os.name AS supplier
        FROM product_offers o
        JOIN warehouses ow ON ow.id=o.warehouse_id
        LEFT JOIN suppliers os ON os.id=o.supplier_id
        WHERE o.product_id=p.id AND o.status IN ('active','out_of_stock')
        ORDER BY (o.status='active' AND o.stock>0) DESC, o.price ASC, o.updated_at DESC, o.id
        LIMIT 1
      ) best ON true
      WHERE ${identityWhere} LIMIT 1`,
      identityParams,
    );
    const product = productResult.rows[0];
    if (!product) return null;
    const id = product.id;
    const [attributes, offers, oems, alternatives, compatibility] = await Promise.all([
      client.query(
        `SELECT attribute_key,attribute_value,source,updated_at FROM product_attributes WHERE product_id=$1 ORDER BY attribute_key`,
        [id],
      ),
      client.query(
        `SELECT o.id::text AS id,w.name AS warehouse,s.name AS supplier,o.price::text,o.stock::text,o.lead_time_days,o.supplier_article,o.status,o.updated_at FROM product_offers o JOIN warehouses w ON w.id=o.warehouse_id LEFT JOIN suppliers s ON s.id=o.supplier_id WHERE o.product_id=$1 ORDER BY (o.status='active' AND o.stock>0) DESC,o.price ASC,o.lead_time_days NULLS LAST,o.updated_at DESC`,
        [id],
      ),
      client.query(
        `SELECT DISTINCT cn.article,b.name AS brand FROM product_cross_numbers pcn JOIN cross_numbers cn ON cn.id=pcn.cross_number_id LEFT JOIN brands b ON b.id=cn.brand_id WHERE pcn.product_id=$1 ORDER BY b.name,cn.normalized_article`,
        [id],
      ),
      client.query(
        `WITH source_numbers AS (
          SELECT cn.id
          FROM cross_numbers cn
          JOIN products p ON p.brand_id=cn.brand_id AND p.normalized_article=cn.normalized_article
          WHERE p.id=$1
          UNION
          SELECT pcn.cross_number_id
          FROM product_cross_numbers pcn
          WHERE pcn.product_id=$1
        ), linked AS (
          SELECT l.right_cross_number_id AS id
          FROM cross_number_links l
          JOIN source_numbers sn ON sn.id=l.left_cross_number_id
          UNION
          SELECT l.left_cross_number_id AS id
          FROM cross_number_links l
          JOIN source_numbers sn ON sn.id=l.right_cross_number_id
        )
        SELECT DISTINCT p2.id::text AS product_id,b2.name AS brand,p2.article,p2.name,p2.price::text,p2.stock::text
        FROM linked
        JOIN cross_numbers cn ON cn.id=linked.id
        JOIN brands b2 ON b2.id=cn.brand_id
        JOIN products p2 ON p2.brand_id=cn.brand_id AND p2.normalized_article=cn.normalized_article
        WHERE p2.id<>$1
        ORDER BY (p2.stock>0) DESC,p2.price ASC
        LIMIT 100`,
        [id],
      ),

      client.query(
        `SELECT DISTINCT vc.id::text,vc.model_id::text,vc.generation_id::text,vc.body_id::text,vc.engine_id::text,vc.modification_id::text,vg.name AS generation,vb.name AS body,vmk.name AS model,vma.name AS make,ve.name AS engine,vf.name AS fuel,ve.displacement_cc,ve.power_kw,mod.name AS modification,vc.year_from,vc.year_to,vc.notes FROM vehicle_compatibility vc LEFT JOIN vehicle_generations vg ON vg.id=vc.generation_id LEFT JOIN vehicle_bodies vb ON vb.id=vc.body_id LEFT JOIN vehicle_models vmk ON vmk.id=vc.model_id LEFT JOIN vehicle_makes vma ON vma.id=vmk.make_id LEFT JOIN vehicle_engines ve ON ve.id=vc.engine_id LEFT JOIN vehicle_modifications mod ON mod.id=vc.modification_id LEFT JOIN vehicle_fuels vf ON vf.id=COALESCE(mod.fuel_id,ve.fuel_id) WHERE vc.product_id=$1 ORDER BY vma.name,vmk.name,vg.year_from`,
        [id],
      ),
    ]);
    return {
      product,
      attributes: attributes.rows,
      offers: offers.rows,
      oems: oems.rows,
      alternatives: alternatives.rows,
      compatibility: compatibility.rows,
    };
  } finally {
    await client.end();
  }
}

export const getProductDetail = createServerFn({ method: "GET" })
  .validator(productInput)
  .handler(async ({ data, context }) => ({ product: await fetchProduct(data, context) }));

export async function handleProductDetailApi(
  request: Request,
  context: AdminRequestContext,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/catalog/product" || request.method !== "GET")
    return Response.json({ ok: false, error: "Маршрут не найден" }, { status: 404 });
  const parsed = productInput.safeParse({
    id: url.searchParams.get("id") ?? undefined,
    brand: url.searchParams.get("brand") ?? undefined,
    article: url.searchParams.get("article") ?? undefined,
  });
  if (!parsed.success) return Response.json({ ok: false, error: "Укажите товар" }, { status: 400 });
  const product = await fetchProduct(parsed.data, context);
  if (!product) return Response.json({ ok: false, error: "Товар не найден" }, { status: 404 });
  return Response.json(
    { ok: true, ...product },
    { headers: { "cache-control": "public, max-age=30, stale-while-revalidate=120" } },
  );
}
