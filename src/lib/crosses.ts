import { createServerFn } from "@tanstack/react-start";
import { Client } from "pg";
import { parse as parseCsv } from "@fast-csv/parse";
import { Readable } from "node:stream";
import { getAdminRequestStatus, type AdminRequestContext } from "@/lib/admin-auth";
import { z } from "zod";

type CrossEndpoint = { brand: string; article: string };
type CrossRow = {
  id: string;
  linked_id: string;
  brand: string;
  article: string;
  linked_brand: string;
  linked_article: string;
  source: string;
  created_at: Date;
};
const endpointSchema = z.object({
  brand: z.string().trim().min(1).max(200),
  article: z.string().trim().min(1).max(200),
});
const saveCrossSchema = z.object({ left: endpointSchema, right: endpointSchema });
const deleteCrossSchema = z.object({
  leftId: z.string().regex(/^\d+$/),
  rightId: z.string().regex(/^\d+$/),
  confirmed: z.literal(true),
});
const updateCrossSchema = z.object({
  oldLeftId: z.string().regex(/^\d+$/),
  oldRightId: z.string().regex(/^\d+$/),
  left: endpointSchema,
  right: endpointSchema,
});
const alternativesSchema = z.object({ crossNumberId: z.string().regex(/^\d+$/) });
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
async function requireAdmin(context: AdminRequestContext): Promise<void> {
  const status = await getAdminRequestStatus(context);
  if (!status.authenticated || status.role !== "admin")
    throw new Response("Forbidden", { status: 403 });
}
function validEndpoint(value: CrossEndpoint): boolean {
  return Boolean(value.brand.trim() && value.article.trim());
}
async function endpointId(client: Client, endpoint: CrossEndpoint): Promise<string> {
  const brand = endpoint.brand.trim();
  const article = endpoint.article.trim();
  const brandResult = await client.query<{ id: string }>(
    `INSERT INTO brands(name) VALUES($1) ON CONFLICT(normalized_name) DO UPDATE SET name=brands.name RETURNING id::text`,
    [brand],
  );
  const brandId = brandResult.rows[0]?.id;
  if (!brandId) throw new Error("Не удалось сохранить бренд");
  const result = await client.query<{ id: string }>(
    `INSERT INTO cross_numbers(brand_id,article) VALUES($1,$2) ON CONFLICT(brand_id,normalized_article) DO UPDATE SET article=cross_numbers.article RETURNING id::text`,
    [brandId, article],
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("Не удалось сохранить артикул");
  return id;
}
async function linkEndpoints(
  client: Client,
  left: CrossEndpoint,
  right: CrossEndpoint,
  source: string,
): Promise<"created" | "duplicate"> {
  if (!validEndpoint(left) || !validEndpoint(right))
    throw new Error("Бренд и артикул обязательны для обеих сторон");
  await client.query("BEGIN");
  try {
    const leftId = await endpointId(client, left);
    const rightId = await endpointId(client, right);
    if (leftId === rightId) throw new Error("Нельзя связать артикул с самим собой");
    const [a, b] = BigInt(leftId) < BigInt(rightId) ? [leftId, rightId] : [rightId, leftId];
    const result = await client.query(
      `INSERT INTO cross_number_links(left_cross_number_id,right_cross_number_id,source) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
      [a, b, source],
    );
    await client.query("COMMIT");
    return result.rowCount ? "created" : "duplicate";
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}
async function insertCanonicalLink(
  client: Client,
  leftId: string,
  rightId: string,
  source: string,
): Promise<"created" | "duplicate"> {
  if (leftId === rightId) throw new Error("Нельзя связать артикул с самим собой");
  const [a, b] = BigInt(leftId) < BigInt(rightId) ? [leftId, rightId] : [rightId, leftId];
  const result = await client.query(
    `INSERT INTO cross_number_links(left_cross_number_id,right_cross_number_id,source) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
    [a, b, source],
  );
  return result.rowCount ? "created" : "duplicate";
}
const listCrossesSchema = z.object({
  search: z.string().trim().max(200).optional(),
  cursor: z.string().max(300).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
const crossCursorSchema = z.object({
  createdAt: z.string(),
  leftId: z.string().regex(/^\d+$/),
  rightId: z.string().regex(/^\d+$/),
});
function decodeCrossCursor(value: string | undefined) {
  if (!value) return null;
  try {
    const parsed = crossCursorSchema.safeParse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
function encodeCrossCursor(value: z.infer<typeof crossCursorSchema>) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
export const listAdminCrosses = createServerFn({ method: "GET" })
  .validator(listCrossesSchema)
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const client = await db(context);
    try {
      const params: unknown[] = [];
      const filter = data.search
        ? `WHERE (lb.normalized_name LIKE upper(btrim($1)) || '%'
          OR lc.normalized_article LIKE normalize_part_article($1) || '%'
          OR rb.normalized_name LIKE upper(btrim($1)) || '%'
          OR rc.normalized_article LIKE normalize_part_article($1) || '%')`
        : "";
      if (data.search) params.push(data.search);
      const cursor = decodeCrossCursor(data.cursor);
      if (data.cursor && !cursor) throw new Response("Некорректный курсор", { status: 400 });
      if (cursor) {
        params.push(cursor.createdAt, cursor.leftId, cursor.rightId);
      }
      const cursorCondition = cursor
        ? `(l.created_at,l.left_cross_number_id,l.right_cross_number_id) < ($${params.length - 2}::timestamptz,$${params.length - 1}::bigint,$${params.length}::bigint)`
        : "";
      params.push(data.limit + 1);
      const result = await client.query<CrossRow>(
        `SELECT l.left_cross_number_id::text AS id, l.right_cross_number_id::text AS linked_id, lb.name brand, lc.article, rb.name linked_brand, rc.article linked_article, l.source, l.created_at FROM cross_number_links l JOIN cross_numbers lc ON lc.id=l.left_cross_number_id JOIN brands lb ON lb.id=lc.brand_id JOIN cross_numbers rc ON rc.id=l.right_cross_number_id JOIN brands rb ON rb.id=rc.brand_id ${filter}${cursorCondition ? `${filter ? " AND " : " WHERE "}${cursorCondition}` : ""} ORDER BY l.created_at DESC,l.left_cross_number_id DESC,l.right_cross_number_id DESC LIMIT $${params.length}`,
        params,
      );
      const hasMore = result.rows.length > data.limit;
      const items = hasMore ? result.rows.slice(0, data.limit) : result.rows;
      const last = items.at(-1);
      return {
        configured: true as const,
        items,
        hasMore,
        nextCursor:
          hasMore && last
            ? encodeCrossCursor({
                createdAt: last.created_at.toISOString(),
                leftId: last.id,
                rightId: last.linked_id,
              })
            : null,
      };
    } finally {
      await client.end();
    }
  });
export const saveAdminCross = createServerFn({ method: "POST" })
  .validator(saveCrossSchema)
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const client = await db(context);
    try {
      const result = await linkEndpoints(
        client,
        data.left as CrossEndpoint,
        data.right as CrossEndpoint,
        "manual",
      );
      return { ok: true as const, result };
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : "Не удалось сохранить кросс",
      };
    } finally {
      await client.end();
    }
  });
export const updateAdminCross = createServerFn({ method: "POST" })
  .validator(updateCrossSchema)
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const client = await db(context);
    try {
      await client.query("BEGIN");
      const leftId = await endpointId(client, data.left);
      const rightId = await endpointId(client, data.right);
      await client.query(
        `DELETE FROM cross_number_links WHERE (left_cross_number_id=$1 AND right_cross_number_id=$2) OR (left_cross_number_id=$2 AND right_cross_number_id=$1)`,
        [data.oldLeftId, data.oldRightId],
      );
      const result = await insertCanonicalLink(client, leftId, rightId, "manual");
      const oldCanonical =
        BigInt(data.oldLeftId) < BigInt(data.oldRightId)
          ? [data.oldLeftId, data.oldRightId]
          : [data.oldRightId, data.oldLeftId];
      const newCanonical = BigInt(leftId) < BigInt(rightId) ? [leftId, rightId] : [rightId, leftId];
      if (
        result === "duplicate" &&
        (oldCanonical[0] !== newCanonical[0] || oldCanonical[1] !== newCanonical[1])
      )
        throw new Error("Такой кросс уже существует");
      await client.query("COMMIT");
      return { ok: true as const, result };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : "Не удалось изменить кросс",
      };
    } finally {
      await client.end();
    }
  });
export const deleteAdminCross = createServerFn({ method: "POST" })
  .validator(deleteCrossSchema)
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const client = await db(context);
    try {
      const result = await client.query(
        `DELETE FROM cross_number_links WHERE (left_cross_number_id=$1 AND right_cross_number_id=$2) OR (left_cross_number_id=$2 AND right_cross_number_id=$1)`,
        [data.leftId, data.rightId],
      );
      return { ok: true as const, deleted: result.rowCount ?? 0 };
    } finally {
      await client.end();
    }
  });
export const listProductAlternatives = createServerFn({ method: "GET" })
  .validator(alternativesSchema)
  .handler(async ({ data, context }) => {
    const client = await db(context);
    try {
      const result = await client.query(
        `WITH linked_ids AS (
           SELECT right_cross_number_id AS id FROM cross_number_links WHERE left_cross_number_id=$1
           UNION
           SELECT left_cross_number_id AS id FROM cross_number_links WHERE right_cross_number_id=$1
         )
         SELECT cn.id::text, b.name AS brand, cn.article, p.id::text AS product_id, p.name, p.price::text, p.stock::text
         FROM linked_ids li JOIN cross_numbers cn ON cn.id=li.id JOIN brands b ON b.id=cn.brand_id
         LEFT JOIN products p ON p.brand_id=cn.brand_id AND p.normalized_article=cn.normalized_article
         ORDER BY b.name,cn.normalized_article`,
        [data.crossNumberId],
      );
      return { items: result.rows };
    } finally {
      await client.end();
    }
  });
export const listAlternativesByEndpoint = createServerFn({ method: "GET" })
  .validator(endpointSchema)
  .handler(async ({ data, context }) => {
    const client = await db(context);
    try {
      const result = await client.query(
        `WITH source AS (
           SELECT cn.id, b.name AS brand, cn.article
           FROM cross_numbers cn JOIN brands b ON b.id=cn.brand_id
           WHERE b.normalized_name=upper(btrim($1)) AND cn.normalized_article=normalize_part_article($2)
           LIMIT 1
         ), linked_ids AS (
           SELECT l.right_cross_number_id AS id FROM cross_number_links l JOIN source s ON s.id=l.left_cross_number_id
           UNION
           SELECT l.left_cross_number_id AS id FROM cross_number_links l JOIN source s ON s.id=l.right_cross_number_id
         )
         SELECT source.id::text AS source_id, source.brand AS source_brand, source.article AS source_article,
           cn.id::text, cb.name AS brand, cn.article, p.id::text AS product_id, p.name, p.price::text, p.stock::text
         FROM source CROSS JOIN linked_ids li JOIN cross_numbers cn ON cn.id=li.id
         JOIN brands cb ON cb.id=cn.brand_id
         LEFT JOIN products p ON p.brand_id=cn.brand_id AND p.normalized_article=cn.normalized_article
         ORDER BY cb.name,cn.normalized_article`,
        [data.brand, data.article],
      );
      return { items: result.rows };
    } finally {
      await client.end();
    }
  });
export async function handleAdminCrossApi(
  request: Request,
  context: AdminRequestContext,
): Promise<Response> {
  await requireAdmin(context);
  const url = new URL(request.url);
  if (url.pathname === "/api/admin/crosses/errors" && request.method === "GET") {
    const runId = url.searchParams.get("runId");
    if (!runId || !/^\d+$/.test(runId))
      return Response.json({ ok: false, error: "Некорректный runId" }, { status: 400 });
    const client = await db(context);
    try {
      const result = await client.query(
        `SELECT row_number, raw_value, code, message FROM cross_import_errors WHERE import_run_id=$1 ORDER BY row_number,id`,
        [runId],
      );
      const header = "row_number;raw_value;code;message\n";
      const csv =
        header +
        result.rows
          .map((row) =>
            [row.row_number, row.raw_value ?? "", row.code, row.message]
              .map((value) => `"${String(value).replaceAll('"', '""')}"`)
              .join(";"),
          )
          .join("\n");
      return new Response(csv, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="cross-errors-${runId}.csv"`,
        },
      });
    } finally {
      await client.end();
    }
  }
  if (url.pathname !== "/api/admin/crosses/import" || request.method !== "POST")
    return Response.json({ ok: false, error: "Маршрут не найден" }, { status: 404 });
  if (!request.body) return Response.json({ ok: false, error: "Пустой CSV" }, { status: 400 });
  const client = await db(context);
  let runId = "";
  let line = 0;
  let processedRows = 0;
  let created = 0;
  let duplicate = 0;
  let errors = 0;
  const batch: Array<{ line: number; row: string[] }> = [];
  const flushBatch = async () => {
    if (!batch.length) return;
    const rows = batch.splice(0, batch.length);
    await client.query("BEGIN");
    try {
      for (const entry of rows) {
        await client.query("SAVEPOINT cross_row");
        try {
          const result = await (async () => {
            const leftId = await endpointId(client, {
              brand: entry.row[0] ?? "",
              article: entry.row[1] ?? "",
            });
            const rightId = await endpointId(client, {
              brand: entry.row[2] ?? "",
              article: entry.row[3] ?? "",
            });
            if (
              !validEndpoint({ brand: entry.row[0] ?? "", article: entry.row[1] ?? "" }) ||
              !validEndpoint({ brand: entry.row[2] ?? "", article: entry.row[3] ?? "" })
            ) {
              throw new Error("Бренд и артикул обязательны для обеих сторон");
            }
            return insertCanonicalLink(client, leftId, rightId, "csv");
          })();
          await client.query("RELEASE SAVEPOINT cross_row");
          if (result === "created") created += 1;
          else duplicate += 1;
        } catch (error) {
          await client.query("ROLLBACK TO SAVEPOINT cross_row");
          await client.query("RELEASE SAVEPOINT cross_row");
          errors += 1;
          await client.query(
            `INSERT INTO cross_import_errors(import_run_id,row_number,raw_value,code,message) VALUES($1,$2,$3,$4,$5)`,
            [
              runId,
              entry.line,
              entry.row.join(";"),
              "INVALID_ROW",
              error instanceof Error ? error.message : "Ошибка строки",
            ],
          );
        }
      }
      await client.query("COMMIT");
      await client.query(
        `UPDATE cross_import_runs SET rows_total=$2,rows_processed=$2,rows_created=$3,rows_duplicate=$4,error_count=$5 WHERE id=$1`,
        [runId, processedRows, created, duplicate, errors],
      );
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  };
  try {
    const run = await client.query<{ id: string }>(
      `INSERT INTO cross_import_runs(filename,status) VALUES($1,'running') RETURNING id::text`,
      [request.headers.get("x-file-name") ?? "crosses.csv"],
    );
    runId = run.rows[0]!.id;
    const parser = Readable.fromWeb(request.body as import("node:stream/web").ReadableStream).pipe(
      parseCsv({ headers: false, delimiter: ";", ignoreEmpty: true, trim: true }),
    );
    for await (const parsed of parser) {
      line += 1;
      const row = (parsed as string[]).map((value, index) =>
        index === 0 ? value.replace(/^\uFEFF/, "") : value,
      );
      const headerTokens = new Set(["бренд", "артикул", "аналог-бренд", "аналог-артикул"]);
      const looksLikeHeader = row.some((value) => headerTokens.has(value.trim().toLowerCase()));
      if (line === 1 && looksLikeHeader) {
        const expected = ["бренд", "артикул", "аналог-бренд", "аналог-артикул"];
        const actual = row.map((value) => value.trim().toLowerCase());
        if (
          actual.length !== expected.length ||
          actual.some((value, index) => value !== expected[index])
        ) {
          errors += 1;
          processedRows += 1;
          await client.query(
            `INSERT INTO cross_import_errors(import_run_id,row_number,raw_value,code,message) VALUES($1,$2,$3,$4,$5)`,
            [
              runId,
              line,
              row.join(";"),
              "HEADER",
              "Ожидался заголовок: Бренд;Артикул;Аналог-Бренд;Аналог-Артикул",
            ],
          );
        }
        continue;
      }
      processedRows += 1;
      if (row.length !== 4) {
        errors += 1;
        await client.query(
          `INSERT INTO cross_import_errors(import_run_id,row_number,raw_value,code,message) VALUES($1,$2,$3,$4,$5)`,
          [runId, line, row.join(";"), "COLUMN_COUNT", "Ожидалось 4 столбца"],
        );
        continue;
      }
      batch.push({ line, row });
      if (batch.length >= 500) await flushBatch();
    }
    await flushBatch();
    const status = errors ? "completed_with_errors" : "completed";
    await client.query(
      `UPDATE cross_import_runs SET status=$2,rows_total=$3,rows_processed=$3,rows_created=$4,rows_duplicate=$5,error_count=$6,finished_at=now(),summary=$7 WHERE id=$1`,
      [
        runId,
        status,
        processedRows,
        created,
        duplicate,
        errors,
        `Обработано строк: ${processedRows}`,
      ],
    );
    return Response.json({ ok: true, runId, rowsTotal: processedRows, created, duplicate, errors });
  } catch (error) {
    if (runId)
      await client.query(
        `UPDATE cross_import_runs SET status='failed',finished_at=now(),summary=$2 WHERE id=$1`,
        [runId, error instanceof Error ? error.message : "Ошибка импорта"],
      );
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Ошибка импорта" },
      { status: 500 },
    );
  } finally {
    await client.end();
  }
}
