import { createServerFn } from "@tanstack/react-start";
import { setResponseHeader } from "@tanstack/react-start/server";
import { Client } from "pg";
import { z } from "zod";
import { getAdminRequestStatus, type AdminRequestContext } from "@/lib/admin-auth";

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const SEARCH_MAX_RESULTS = 50;
const cursorSchema = z.object({
  sort: z.string(),
  value: z.string(),
  id: z.string().regex(/^\d+$/),
});

const listProductsInput = z.object({
  search: z.string().trim().max(120).optional(),
  brandId: z.coerce.number().int().positive().optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  warehouseId: z.coerce.number().int().positive().optional(),
  supplierId: z.coerce.number().int().positive().optional(),
  status: z.enum(["active", "draft", "archived"]).optional(),
  sort: z.enum(["article", "price-asc", "price-desc", "updated"]).default("article"),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

type ProductCursor = z.infer<typeof cursorSchema>;
type ProductRow = {
  id: string;
  brand_id: string;
  brand_name: string;
  article: string;
  normalized_article: string;
  name: string;
  category_id: string | null;
  category_name: string | null;
  price: string;
  stock: string;
  warehouse_name: string | null;
  supplier_name: string | null;
  status: "active" | "draft" | "archived";
  updated_at: Date;
};

function normalizeArticle(value: string): string {
  return value
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function encodeCursor(cursor: ProductCursor): string {
  return btoa(JSON.stringify(cursor)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function decodeCursor(value: string): ProductCursor | null {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = cursorSchema.safeParse(
      JSON.parse(atob(normalized + "=".repeat((4 - (normalized.length % 4)) % 4))),
    );
    return decoded.success ? decoded.data : null;
  } catch {
    return null;
  }
}

function getConnectionString(context: AdminRequestContext): string | undefined {
  const runtime = context.adminRuntime;
  const hyperdrive = runtime?.bindings?.HYPERDRIVE;
  return (
    hyperdrive?.connectionString ??
    process.env["POSTGRES_URL"] ??
    process.env["DATABASE_URL"] ??
    process.env["POSTGRES_PRISMA_URL"] ??
    process.env["POSTGRES_URL_NON_POOLING"]
  );
}

const catalogSearchInput = z.object({
  query: z.string().trim().min(1).max(120),
  brandId: z.coerce.number().int().positive().optional(),
  warehouseId: z.coerce.number().int().positive().optional(),
  status: z.enum(["active", "draft", "archived"]).optional(),
  limit: z.coerce.number().int().min(1).max(SEARCH_MAX_RESULTS).default(20),
});

type CatalogSearchRow = {
  id: string;
  brand_id: string;
  brand_name: string;
  article: string;
  normalized_article: string;
  name: string;
  price: string;
  stock: string;
  status: string;
  relevance: number;
  matched_by: string;
  cross_numbers: string[];
};

export const searchCatalog = createServerFn({ method: "GET" })
  .validator(catalogSearchInput)
  .handler(async ({ data, context }) => {
    setResponseHeader("Cache-Control", "public, max-age=15, stale-while-revalidate=60");
    const connectionString = getConnectionString(context);
    if (!connectionString)
      return {
        configured: false as const,
        items: [],
        vehicles: [],
        message: "Каталог временно недоступен.",
      };
    const normalized = normalizeArticle(data.query);
    const params: unknown[] = [data.query, normalized];
    const where: string[] = [];
    const addParam = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    if (data.brandId) where.push(`p.brand_id=${addParam(data.brandId)}`);
    if (data.status) where.push(`p.status=${addParam(data.status)}`);
    if (data.warehouseId) {
      const warehouse = addParam(data.warehouseId);
      where.push(
        `(p.warehouse_id=${warehouse} OR EXISTS (SELECT 1 FROM warehouse_products wp WHERE wp.product_id=p.id AND wp.warehouse_id=${warehouse}))`,
      );
    }
    const limit = addParam(data.limit);
    const sql = `
      WITH candidates AS (
        SELECT p.id,
          CASE
            WHEN p.normalized_article=$2 THEN 120
            WHEN p.normalized_article LIKE $2 || '%' THEN 100
            WHEN b.normalized_name=upper(btrim($1)) THEN 88
            WHEN p.article ILIKE '%' || $1 || '%' THEN 78
            WHEN p.name ILIKE '%' || $1 || '%' THEN 68
            WHEN EXISTS (SELECT 1 FROM product_cross_numbers pcn JOIN cross_numbers cn ON cn.id=pcn.cross_number_id WHERE pcn.product_id=p.id AND (cn.normalized_article=$2 OR cn.normalized_article LIKE $2 || '%' OR cn.article ILIKE '%' || $1 || '%')) THEN 92
            WHEN EXISTS (SELECT 1 FROM vehicle_compatibility vc JOIN vehicle_models vm ON vm.id=vc.model_id JOIN vehicle_makes vmake ON vmake.id=vm.make_id WHERE vc.product_id=p.id AND (vm.normalized_name ILIKE '%' || $1 || '%' OR vmake.normalized_name ILIKE '%' || $1 || '%')) THEN 74
            ELSE 0
          END AS relevance,
          CASE
            WHEN p.normalized_article=$2 THEN 'article_exact'
            WHEN p.normalized_article LIKE $2 || '%' THEN 'article_prefix'
            WHEN b.normalized_name=upper(btrim($1)) THEN 'brand'
            WHEN EXISTS (SELECT 1 FROM product_cross_numbers pcn JOIN cross_numbers cn ON cn.id=pcn.cross_number_id WHERE pcn.product_id=p.id AND (cn.normalized_article=$2 OR cn.normalized_article LIKE $2 || '%' OR cn.article ILIKE '%' || $1 || '%')) THEN 'cross'
            WHEN EXISTS (SELECT 1 FROM vehicle_compatibility vc JOIN vehicle_models vm ON vm.id=vc.model_id JOIN vehicle_makes vmake ON vmake.id=vm.make_id WHERE vc.product_id=p.id AND (vm.normalized_name ILIKE '%' || $1 || '%' OR vmake.normalized_name ILIKE '%' || $1 || '%')) THEN 'vehicle'
            WHEN p.name ILIKE '%' || $1 || '%' THEN 'name'
            ELSE 'article'
          END AS matched_by
        FROM products p JOIN brands b ON b.id=p.brand_id
        WHERE (p.normalized_article LIKE $2 || '%' OR p.article ILIKE '%' || $1 || '%' OR b.normalized_name LIKE upper(btrim($1)) || '%' OR b.name ILIKE '%' || $1 || '%' OR p.name ILIKE '%' || $1 || '%'
          OR EXISTS (SELECT 1 FROM product_cross_numbers pcn JOIN cross_numbers cn ON cn.id=pcn.cross_number_id WHERE pcn.product_id=p.id AND (cn.normalized_article LIKE $2 || '%' OR cn.article ILIKE '%' || $1 || '%'))
          OR EXISTS (SELECT 1 FROM vehicle_compatibility vc JOIN vehicle_models vm ON vm.id=vc.model_id JOIN vehicle_makes vmake ON vmake.id=vm.make_id WHERE vc.product_id=p.id AND (vm.normalized_name ILIKE '%' || $1 || '%' OR vmake.normalized_name ILIKE '%' || $1 || '%')))
          ${where.length ? `AND ${where.join(" AND ")}` : ""}
        ORDER BY relevance DESC, p.stock DESC, p.updated_at DESC, p.id
        LIMIT ${limit}
      )
      SELECT p.id::text, p.brand_id::text, b.name AS brand_name, p.article, p.normalized_article, p.name, p.price::text, p.stock::text, p.status, c.relevance, c.matched_by,
        COALESCE((SELECT array_agg(limited.article ORDER BY limited.normalized_article) FROM (SELECT cn.article, cn.normalized_article FROM product_cross_numbers pcn JOIN cross_numbers cn ON cn.id=pcn.cross_number_id WHERE pcn.product_id=p.id ORDER BY cn.normalized_article LIMIT 12) limited), ARRAY[]::text[]) AS cross_numbers
      FROM candidates c JOIN products p ON p.id=c.id JOIN brands b ON b.id=p.brand_id
      ORDER BY c.relevance DESC,p.stock DESC,p.updated_at DESC,p.id`;
    const client = new Client({
      connectionString,
      connectionTimeoutMillis: 5000,
      query_timeout: 15000,
    });
    try {
      await client.connect();
      const result = await client.query<CatalogSearchRow>(sql, params);
      const vehicles = await client.query(
        `SELECT DISTINCT vmake.name AS make, vm.name AS model FROM vehicle_models vm JOIN vehicle_makes vmake ON vmake.id=vm.make_id WHERE vm.name ILIKE '%' || $1 || '%' OR vmake.name ILIKE '%' || $1 || '%' ORDER BY vmake.name,vm.name LIMIT 10`,
        [data.query],
      );
      return {
        configured: true as const,
        items: result.rows,
        vehicles: vehicles.rows,
        message: null,
      };
    } finally {
      await client.end().catch(() => undefined);
    }
  });

export const autocompleteCatalog = createServerFn({ method: "GET" })
  .validator(
    z.object({
      query: z.string().trim().min(1).max(80),
      limit: z.coerce.number().int().min(1).max(10).default(8),
    }),
  )
  .handler(async ({ data, context }) => {
    const connectionString = getConnectionString(context);
    if (!connectionString) return { configured: false as const, items: [] };
    const normalized = normalizeArticle(data.query);
    const client = new Client({
      connectionString,
      connectionTimeoutMillis: 5000,
      query_timeout: 5000,
    });
    try {
      await client.connect();
      const result = await client.query(
        `SELECT p.id::text, b.name AS brand, p.article, p.name, p.normalized_article, 'product' AS kind FROM products p JOIN brands b ON b.id=p.brand_id WHERE p.normalized_article LIKE $1 || '%' OR b.normalized_name LIKE upper(btrim($2)) || '%' OR p.name ILIKE '%' || $2 || '%' OR EXISTS (SELECT 1 FROM product_cross_numbers pcn JOIN cross_numbers cn ON cn.id=pcn.cross_number_id WHERE pcn.product_id=p.id AND cn.normalized_article LIKE $1 || '%') ORDER BY (p.normalized_article=$1) DESC,(p.normalized_article LIKE $1 || '%') DESC,p.normalized_article,p.id LIMIT $3`,
        [normalized, data.query, data.limit],
      );
      const vehicles = await client.query(
        `SELECT vmake.name AS brand, vm.name AS model, 'vehicle' AS kind FROM vehicle_models vm JOIN vehicle_makes vmake ON vmake.id=vm.make_id WHERE vm.name ILIKE '%' || $1 || '%' OR vmake.name ILIKE '%' || $1 || '%' ORDER BY vmake.name,vm.name LIMIT $2`,
        [data.query, Math.min(data.limit, 5)],
      );
      return {
        configured: true as const,
        items: [...result.rows, ...vehicles.rows].slice(0, data.limit),
      };
    } finally {
      await client.end().catch(() => undefined);
    }
  });

export async function handleCatalogSearchApi(
  request: Request,
  context: AdminRequestContext,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/catalog/search" || request.method !== "GET")
    return Response.json({ ok: false, error: "Маршрут не найден" }, { status: 404 });
  const query = url.searchParams.get("q") ?? "";
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 20), SEARCH_MAX_RESULTS);
  const parsed = catalogSearchInput.safeParse({
    query,
    limit: Number.isFinite(limit) ? limit : 20,
  });
  if (!parsed.success)
    return Response.json({ ok: false, error: "Некорректный поисковый запрос" }, { status: 400 });
  const connectionString = getConnectionString(context);
  if (!connectionString)
    return Response.json({ ok: false, error: "Каталог временно недоступен" }, { status: 503 });
  const normalized = normalizeArticle(parsed.data.query);
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 5000,
    query_timeout: 15000,
  });
  try {
    await client.connect();
    const result = await client.query(
      `
      SELECT p.id::text, b.name AS brand, p.article, p.name, p.price::text, p.stock::text,
        CASE WHEN p.normalized_article=$2 THEN 'article_exact' WHEN p.normalized_article LIKE $2 || '%' THEN 'article_prefix' WHEN b.normalized_name=upper(btrim($1)) THEN 'brand' ELSE 'text' END AS matched_by
      FROM products p JOIN brands b ON b.id=p.brand_id
      WHERE p.normalized_article LIKE $2 || '%' OR p.article ILIKE '%' || $1 || '%' OR b.normalized_name LIKE upper(btrim($1)) || '%' OR p.name ILIKE '%' || $1 || '%'
        OR EXISTS (SELECT 1 FROM product_cross_numbers pcn JOIN cross_numbers cn ON cn.id=pcn.cross_number_id WHERE pcn.product_id=p.id AND (cn.normalized_article LIKE $2 || '%' OR cn.article ILIKE '%' || $1 || '%'))
      ORDER BY (p.normalized_article=$2) DESC,(p.normalized_article LIKE $2 || '%') DESC,p.stock DESC,p.id LIMIT $3`,
      [parsed.data.query, normalized, parsed.data.limit],
    );
    return Response.json(
      { ok: true, items: result.rows },
      { headers: { "cache-control": "public, max-age=15, stale-while-revalidate=60" } },
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

function getSortConfig(sort: z.infer<typeof listProductsInput>["sort"]) {
  switch (sort) {
    case "price-asc":
      return { expression: "p.price", direction: "ASC", cast: "numeric" };
    case "price-desc":
      return { expression: "p.price", direction: "DESC", cast: "numeric" };
    case "updated":
      return { expression: "p.updated_at", direction: "DESC", cast: "timestamptz" };
    default:
      return { expression: "p.normalized_article", direction: "ASC", cast: "text" };
  }
}

export const listAdminProducts = createServerFn({ method: "GET" })
  .validator(listProductsInput)
  .handler(async ({ data, context }) => {
    setResponseHeader("Cache-Control", "private, no-store");
    const admin = await getAdminRequestStatus(context);
    if (!admin.authenticated || admin.role !== "admin") {
      throw new Response("Forbidden", { status: 403 });
    }

    const connectionString = getConnectionString(context);
    if (!connectionString) {
      return {
        configured: false as const,
        items: [] as const,
        hasMore: false,
        nextCursor: null,
        message: "Подключите PostgreSQL через HYPERDRIVE или задайте DATABASE_URL.",
      };
    }

    const params: unknown[] = [];
    const where: string[] = [];
    const addParam = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };

    if (data.status) where.push(`p.status = ${addParam(data.status)}`);
    if (data.brandId) where.push(`p.brand_id = ${addParam(data.brandId)}`);
    if (data.categoryId)
      where.push(`(p.category_id = ${addParam(data.categoryId)} OR EXISTS (
      SELECT 1 FROM product_categories pc
      WHERE pc.product_id = p.id AND pc.category_id = $${params.length}
    ))`);
    if (data.supplierId) where.push(`p.supplier_id = ${addParam(data.supplierId)}`);
    if (data.warehouseId) {
      const warehouseParam = addParam(data.warehouseId);
      where.push(`(p.warehouse_id = ${warehouseParam} OR EXISTS (
        SELECT 1 FROM warehouse_products wp
        WHERE wp.product_id = p.id AND wp.warehouse_id = ${warehouseParam}
      ))`);
    }

    if (data.search) {
      const normalized = normalizeArticle(data.search);
      const nameParam = addParam(data.search);
      const articleSearch = normalized
        ? (() => {
            const normalizedParam = addParam(normalized);
            return `p.normalized_article LIKE ${normalizedParam} || '%' OR EXISTS (
              SELECT 1 FROM product_cross_numbers pcn
              JOIN cross_numbers cn ON cn.id = pcn.cross_number_id
              WHERE pcn.product_id = p.id AND cn.normalized_article LIKE ${normalizedParam} || '%'
            )`;
          })()
        : "FALSE";
      where.push(`(${articleSearch} OR p.name ILIKE '%' || ${nameParam} || '%')`);
    }

    const { expression, direction, cast } = getSortConfig(data.sort);
    if (data.cursor) {
      const cursor = decodeCursor(data.cursor);
      if (!cursor || cursor.sort !== data.sort)
        throw new Response("Invalid cursor", { status: 400 });
      const valueParam = addParam(cursor.value);
      const idParam = addParam(cursor.id);
      const comparator = direction === "ASC" ? ">" : "<";
      where.push(
        `(${expression}, p.id) ${comparator} (${valueParam}::${cast}, ${idParam}::bigint)`,
      );
    }

    const limitParam = addParam(data.limit + 1);
    const sql = `
      SELECT p.id::text, p.brand_id::text, b.name AS brand_name,
        p.article, p.normalized_article, p.name,
        p.category_id::text, c.name AS category_name,
        p.price::text, p.stock::text, w.name AS warehouse_name,
        s.name AS supplier_name, p.status, p.updated_at
      FROM products p
      JOIN brands b ON b.id = p.brand_id
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN warehouses w ON w.id = p.warehouse_id
      LEFT JOIN suppliers s ON s.id = p.supplier_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY ${expression} ${direction}, p.id ${direction}
      LIMIT ${limitParam}`;

    const client = new Client({
      connectionString,
      connectionTimeoutMillis: 5000,
      query_timeout: 15000,
    });
    try {
      await client.connect();
      const result = await client.query<ProductRow>(sql, params);
      const hasMore = result.rows.length > data.limit;
      const items = result.rows.slice(0, data.limit);
      const last = items.at(-1);
      const sortValue = last
        ? data.sort === "price-asc" || data.sort === "price-desc"
          ? last.price
          : data.sort === "updated"
            ? last.updated_at.toISOString()
            : last.normalized_article
        : null;
      return {
        configured: true as const,
        items,
        hasMore,
        nextCursor:
          hasMore && last && sortValue !== null
            ? encodeCursor({ sort: data.sort, value: sortValue, id: last.id })
            : null,
        message: null,
      };
    } catch (error) {
      console.error("Admin catalog query failed", error);
      throw new Response("Не удалось загрузить каталог. Проверьте соединение с базой.", {
        status: 503,
      });
    } finally {
      await client.end().catch(() => undefined);
    }
  });

export const getAdminCatalogOverview = createServerFn({ method: "GET" }).handler(
  async ({ context }) => {
    setResponseHeader("Cache-Control", "private, no-store");
    const admin = await getAdminRequestStatus(context);
    if (!admin.authenticated || admin.role !== "admin") {
      throw new Response("Forbidden", { status: 403 });
    }
    const connectionString = getConnectionString(context);
    if (!connectionString) return { configured: false as const };

    const client = new Client({
      connectionString,
      connectionTimeoutMillis: 5000,
      query_timeout: 15000,
    });
    try {
      await client.connect();
      const result = await client.query<{
        products: string;
        articles: string;
        brands: string;
        crosses: string;
        warehouses: string;
        suppliers: string;
        import_errors: string;
        last_import: string | null;
        last_import_status: string | null;
        last_price_update: string | null;
        last_price_status: string | null;
      }>(`
        SELECT
          COALESCE((SELECT GREATEST(reltuples, 0)::bigint FROM pg_class WHERE oid = to_regclass(format('%I.products', current_schema()))), 0)::text AS products,
          COALESCE((SELECT GREATEST(reltuples, 0)::bigint FROM pg_class WHERE oid = to_regclass(format('%I.articles', current_schema()))), 0)::text AS articles,
          COALESCE((SELECT GREATEST(reltuples, 0)::bigint FROM pg_class WHERE oid = to_regclass(format('%I.brands', current_schema()))), 0)::text AS brands,
          COALESCE((SELECT GREATEST(reltuples, 0)::bigint FROM pg_class WHERE oid = to_regclass(format('%I.cross_numbers', current_schema()))), 0)::text AS crosses,
          COALESCE((SELECT GREATEST(reltuples, 0)::bigint FROM pg_class WHERE oid = to_regclass(format('%I.warehouses', current_schema()))), 0)::text AS warehouses,
          COALESCE((SELECT GREATEST(reltuples, 0)::bigint FROM pg_class WHERE oid = to_regclass(format('%I.suppliers', current_schema()))), 0)::text AS suppliers,
          (SELECT count(*)::text FROM import_errors WHERE resolved_at IS NULL) AS import_errors,
          (SELECT created_at::text FROM import_runs ORDER BY created_at DESC, id DESC LIMIT 1) AS last_import,
          (SELECT status FROM import_runs ORDER BY created_at DESC, id DESC LIMIT 1) AS last_import_status,
          (SELECT created_at::text FROM price_update_runs ORDER BY created_at DESC, id DESC LIMIT 1) AS last_price_update,
          (SELECT status FROM price_update_runs ORDER BY created_at DESC, id DESC LIMIT 1) AS last_price_status
      `);
      return { configured: true as const, ...result.rows[0] };
    } catch (error) {
      console.error("Admin catalog overview query failed", error);
      throw new Response("Не удалось загрузить сводку базы данных.", { status: 503 });
    } finally {
      await client.end().catch(() => undefined);
    }
  },
);
