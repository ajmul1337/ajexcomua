import { createServerFn } from "@tanstack/react-start";
import { Client } from "pg";
import { z } from "zod";
import { getAdminRequestStatus, type AdminRequestContext } from "@/lib/admin-auth";

const id = z.string().regex(/^\d+$/);
const productId = z.object({ id });
const endpoint = z.object({
  brand: z.string().trim().min(1).max(200),
  article: z.string().trim().min(1).max(200),
});
const updateInput = z.object({
  id,
  name: z.string().trim().min(1).max(500),
  description: z.string().max(10000).nullable(),
  price: z.coerce.number().min(0).max(1_000_000_000),
  stock: z.coerce.number().int().min(0).max(2_000_000_000),
  brand: z.string().trim().min(1).max(200),
  categoryId: id.nullable(),
  status: z.enum(["active", "draft", "archived"]),
});
const bulkInput = z.object({
  ids: z.array(id).min(1).max(1000),
  action: z.enum(["status", "category", "delete", "refresh"]),
  status: z.enum(["active", "draft", "archived"]).optional(),
  categoryId: id.nullable().optional(),
  confirmed: z.boolean().optional(),
});
const auditInput = z.object({ id, limit: z.coerce.number().int().min(1).max(100).default(50) });

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
    query_timeout: 30000,
  });
  await client.connect();
  return client;
}
async function requireAdmin(context: AdminRequestContext): Promise<void> {
  const status = await getAdminRequestStatus(context);
  if (!status.authenticated || status.role !== "admin")
    throw new Response("Forbidden", { status: 403 });
}
async function audit(client: Client, productId: string | null, action: string, payload: unknown) {
  await client.query(
    "INSERT INTO product_admin_audit(product_id,action,payload) VALUES($1,$2,$3::jsonb)",
    [productId, action, JSON.stringify(payload)],
  );
}

export const getAdminProduct = createServerFn({ method: "GET" })
  .validator(productId)
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const client = await db(context);
    try {
      const [product, attributes, oems, offers, crosses, compatibility, history] =
        await Promise.all([
          client.query(
            `SELECT p.id::text,p.article,p.name,p.description,p.price::text,p.stock::text,p.status,p.brand_id::text,b.name AS brand,p.category_id::text,c.name AS category,p.updated_at FROM products p JOIN brands b ON b.id=p.brand_id LEFT JOIN categories c ON c.id=p.category_id WHERE p.id=$1`,
            [data.id],
          ),
          client.query(
            `SELECT attribute_key,attribute_value,source,updated_at FROM product_attributes WHERE product_id=$1 ORDER BY attribute_key`,
            [data.id],
          ),
          client.query(
            `SELECT o.id::text,w.name AS warehouse,s.name AS supplier,o.price::text,o.stock::text,o.lead_time_days,o.supplier_article,o.status,o.updated_at FROM product_offers o JOIN warehouses w ON w.id=o.warehouse_id LEFT JOIN suppliers s ON s.id=o.supplier_id WHERE o.product_id=$1 ORDER BY o.updated_at DESC`,
            [data.id],
          ),
          client.query(
            `SELECT cn.id::text,b.name AS brand,cn.article FROM product_cross_numbers pcn JOIN cross_numbers cn ON cn.id=pcn.cross_number_id LEFT JOIN brands b ON b.id=cn.brand_id WHERE pcn.product_id=$1 AND pcn.source='admin_oem' ORDER BY b.name,cn.article`,
            [data.id],
          ),
          client.query(
            `WITH source AS (SELECT cn.id FROM products p JOIN cross_numbers cn ON cn.brand_id=p.brand_id AND cn.normalized_article=p.normalized_article WHERE p.id=$1 UNION SELECT cross_number_id FROM product_cross_numbers WHERE product_id=$1), linked AS (SELECT l.right_cross_number_id id FROM cross_number_links l JOIN source s ON s.id=l.left_cross_number_id UNION SELECT l.left_cross_number_id FROM cross_number_links l JOIN source s ON s.id=l.right_cross_number_id) SELECT DISTINCT cn.id::text,b.name AS brand,cn.article,p.id::text AS product_id FROM linked JOIN cross_numbers cn ON cn.id=linked.id JOIN brands b ON b.id=cn.brand_id LEFT JOIN products p ON p.brand_id=cn.brand_id AND p.normalized_article=cn.normalized_article ORDER BY b.name,cn.article`,
            [data.id],
          ),
          client.query(
            `SELECT vc.id::text,vmk.name AS model,vg.name AS generation,mod.name AS modification,vc.year_from,vc.year_to FROM vehicle_compatibility vc LEFT JOIN vehicle_models vmk ON vmk.id=vc.model_id LEFT JOIN vehicle_generations vg ON vg.id=vc.generation_id LEFT JOIN vehicle_modifications mod ON mod.id=vc.modification_id WHERE vc.product_id=$1 ORDER BY vmk.name,vg.name`,
            [data.id],
          ),
          client.query(
            `SELECT id::text,action,payload,created_at FROM product_admin_audit WHERE product_id=$1 ORDER BY created_at DESC,id DESC LIMIT 50`,
            [data.id],
          ),
        ]);
      return {
        product: product.rows[0] ?? null,
        attributes: attributes.rows,
        oems: oems.rows,
        offers: offers.rows,
        crosses: crosses.rows,
        compatibility: compatibility.rows,
        history: history.rows,
      };
    } finally {
      await client.end();
    }
  });

export const updateAdminProduct = createServerFn({ method: "POST" })
  .validator(updateInput)
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const client = await db(context);
    try {
      await client.query("BEGIN");
      const brand = await client.query(
        `INSERT INTO brands(name) VALUES($1) ON CONFLICT(normalized_name) DO UPDATE SET name=brands.name RETURNING id::text`,
        [data.brand],
      );
      const brandId = brand.rows[0]?.id;
      if (!brandId) throw new Error("Не удалось сохранить бренд");
      const article = await client.query(
        `INSERT INTO articles(brand_id,article) SELECT $1,p.article FROM products p WHERE p.id=$2 ON CONFLICT(brand_id,normalized_article) DO UPDATE SET article=articles.article RETURNING id::text`,
        [brandId, data.id],
      );
      const articleId = article.rows[0]?.id;
      if (!articleId) throw new Error("Не удалось сохранить артикул");
      await client.query(
        `UPDATE products SET brand_id=$2,article_id=$3,name=$4,description=$5,price=$6,stock=$7,category_id=$8,status=$9,updated_at=now() WHERE id=$1`,
        [
          data.id,
          brandId,
          articleId,
          data.name,
          data.description,
          data.price,
          data.stock,
          data.categoryId,
          data.status,
        ],
      );
      await audit(client, data.id, "update", {
        fields: ["brand", "name", "description", "price", "stock", "category", "status"],
      });
      await client.query("COMMIT");
      return { ok: true as const };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : "Не удалось обновить товар",
      };
    } finally {
      await client.end();
    }
  });

export const setAdminProductOem = createServerFn({ method: "POST" })
  .validator(
    z.object({
      productId: id,
      brand: z.string().trim().min(1).max(200),
      articles: z.array(z.string().trim().min(1).max(200)).max(100),
    }),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const client = await db(context);
    try {
      await client.query("BEGIN");
      const brand = await client.query(
        `INSERT INTO brands(name) VALUES($1) ON CONFLICT(normalized_name) DO UPDATE SET name=brands.name RETURNING id`,
        [data.brand],
      );
      const brandId = brand.rows[0]?.id;
      if (!brandId) throw new Error("Не удалось сохранить OEM бренд");
      await client.query(
        `DELETE FROM product_cross_numbers WHERE product_id=$1 AND source='admin_oem'`,
        [data.productId],
      );
      for (const article of data.articles) {
        const cross = await client.query(
          `INSERT INTO cross_numbers(brand_id,article) VALUES($1,$2) ON CONFLICT(brand_id,normalized_article) DO UPDATE SET article=cross_numbers.article RETURNING id`,
          [brandId, article],
        );
        if (cross.rows[0])
          await client.query(
            `INSERT INTO product_cross_numbers(product_id,cross_number_id,source) VALUES($1,$2,'admin_oem') ON CONFLICT DO NOTHING`,
            [data.productId, cross.rows[0].id],
          );
      }
      await audit(client, data.productId, "update_oem", {
        brand: data.brand,
        count: data.articles.length,
      });
      await client.query("COMMIT");
      return { ok: true as const };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : "Не удалось обновить OEM",
      };
    } finally {
      await client.end();
    }
  });
export const addAdminProductCross = createServerFn({ method: "POST" })
  .validator(z.object({ productId: id, endpoint }))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const client = await db(context);
    try {
      await client.query("BEGIN");
      const source = await client.query(
        `SELECT p.brand_id::text AS brand_id,p.article FROM products p WHERE p.id=$1`,
        [data.productId],
      );
      const row = source.rows[0];
      if (!row) throw new Error("Товар не найден");
      const brands = await client.query(
        `INSERT INTO brands(name) VALUES($1) ON CONFLICT(normalized_name) DO UPDATE SET name=brands.name RETURNING id::text`,
        [data.endpoint.brand],
      );
      const targetBrand = brands.rows[0]?.id;
      const sourceCross = await client.query(
        `INSERT INTO cross_numbers(brand_id,article) VALUES($1,$2) ON CONFLICT(brand_id,normalized_article) DO UPDATE SET article=cross_numbers.article RETURNING id::text`,
        [row.brand_id, row.article],
      );
      const targetCross = await client.query(
        `INSERT INTO cross_numbers(brand_id,article) VALUES($1,$2) ON CONFLICT(brand_id,normalized_article) DO UPDATE SET article=cross_numbers.article RETURNING id::text`,
        [targetBrand, data.endpoint.article],
      );
      const a = BigInt(sourceCross.rows[0].id),
        b = BigInt(targetCross.rows[0].id);
      if (a === b) throw new Error("Нельзя связать товар с самим собой");
      const left = a < b ? a.toString() : b.toString(),
        right = a < b ? b.toString() : a.toString();
      await client.query(
        `INSERT INTO cross_number_links(left_cross_number_id,right_cross_number_id,source) VALUES($1,$2,'admin') ON CONFLICT DO NOTHING`,
        [left, right],
      );
      await audit(client, data.productId, "add_cross", data.endpoint);
      await client.query("COMMIT");
      return { ok: true as const };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : "Не удалось добавить аналог",
      };
    } finally {
      await client.end();
    }
  });

export const deleteAdminProductCross = createServerFn({ method: "POST" })
  .validator(z.object({ productId: id, crossNumberId: id, confirmed: z.literal(true) }))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const client = await db(context);
    try {
      const result = await client.query(
        `WITH source AS (SELECT cn.id FROM products p JOIN cross_numbers cn ON cn.brand_id=p.brand_id AND cn.normalized_article=p.normalized_article WHERE p.id=$1 UNION SELECT cross_number_id FROM product_cross_numbers WHERE product_id=$1) DELETE FROM cross_number_links l USING source s WHERE (l.left_cross_number_id=s.id AND l.right_cross_number_id=$2) OR (l.right_cross_number_id=s.id AND l.left_cross_number_id=$2)`,
        [data.productId, data.crossNumberId],
      );
      await audit(client, data.productId, "delete_cross", { crossNumberId: data.crossNumberId });
      return { ok: true as const, deleted: result.rowCount ?? 0 };
    } finally {
      await client.end();
    }
  });

export const listAdminProductHistory = createServerFn({ method: "GET" })
  .validator(auditInput)
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const client = await db(context);
    try {
      const result = await client.query(
        `SELECT id::text,action,payload,created_at FROM product_admin_audit WHERE product_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2`,
        [data.id, data.limit],
      );
      return { items: result.rows };
    } finally {
      await client.end();
    }
  });

export const bulkAdminProducts = createServerFn({ method: "POST" })
  .validator(bulkInput)
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const client = await db(context);
    try {
      await client.query("BEGIN");
      const ids = data.ids;
      if (data.action === "delete") {
        if (data.confirmed !== true) throw new Error("Требуется подтверждение удаления");
        const result = await client.query(`DELETE FROM products WHERE id = ANY($1::bigint[])`, [
          ids,
        ]);
        await audit(client, null, "bulk_delete", { count: result.rowCount, ids });
        await client.query("COMMIT");
        return { ok: true as const, affected: result.rowCount ?? 0 };
      }
      let result;
      if (data.action === "status") {
        if (!data.status) throw new Error("Не указан статус");
        result = await client.query(
          `UPDATE products SET status=$2,updated_at=now() WHERE id=ANY($1::bigint[])`,
          [ids, data.status],
        );
      } else if (data.action === "category")
        result = await client.query(
          `UPDATE products SET category_id=$2,updated_at=now() WHERE id=ANY($1::bigint[])`,
          [ids, data.categoryId ?? null],
        );
      else
        result = await client.query(
          `UPDATE products p SET stock=COALESCE((SELECT SUM(o.stock) FROM product_offers o WHERE o.product_id=p.id),p.stock), price=COALESCE((SELECT o.price FROM product_offers o WHERE o.product_id=p.id AND o.status='active' AND o.stock>0 ORDER BY o.price ASC,o.updated_at DESC LIMIT 1),p.price), updated_at=now() WHERE p.id=ANY($1::bigint[])`,
          [ids],
        );
      await audit(client, null, `bulk_${data.action}`, {
        count: result.rowCount,
        ids,
        status: data.status,
        categoryId: data.categoryId,
      });
      await client.query("COMMIT");
      return { ok: true as const, affected: result.rowCount ?? 0 };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : "Массовая операция не выполнена",
      };
    } finally {
      await client.end();
    }
  });
