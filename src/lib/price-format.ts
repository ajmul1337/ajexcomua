export type PriceColumn = "article" | "brand" | "name" | "price" | "stock";
export type PriceColumnMapping = Partial<Record<PriceColumn, string>>;

const headerAliases: Record<PriceColumn, string[]> = {
  article: ["артикул", "кодтовара", "код", "sku", "article", "partnumber", "номердетали", "номер"],
  brand: ["бренд", "производитель", "марка", "brand", "manufacturer", "maker"],
  name: ["название", "наименование", "товар", "описание", "name", "product", "description"],
  price: ["цена", "оптоваяцена", "розничнаяцена", "price", "cost", "amount"],
  stock: ["остаток", "наличие", "количество", "quantity", "qty", "stock", "available"],
};

function normalizeHeader(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/** Uses warehouse-saved header names first, then common supplier column names. */
export function detectPriceColumns(headers: string[], savedMapping: PriceColumnMapping = {}) {
  const normalizedHeaders = headers.map((header) => ({
    raw: header,
    normalized: normalizeHeader(header),
  }));
  const result: Partial<Record<PriceColumn, string>> = {};
  for (const field of Object.keys(headerAliases) as PriceColumn[]) {
    const configured = savedMapping[field] ? normalizeHeader(savedMapping[field]!) : "";
    const matched = configured
      ? normalizedHeaders.find((header) => header.normalized === configured)
      : normalizedHeaders.find((header) =>
          headerAliases[field].some((alias) => {
            const aliasNormalized = normalizeHeader(alias);
            return (
              header.normalized === aliasNormalized ||
              (aliasNormalized.length >= 5 && header.normalized.includes(aliasNormalized))
            );
          }),
        );
    if (matched) result[field] = matched.raw;
  }
  return result;
}

export function detectPriceFormat(
  filename: string,
  sample = "",
): "csv" | "xlsx" | "xls" | "xml" | "json" | "unknown" {
  const extension = filename.split(".").at(-1)?.toLowerCase();
  if (extension === "csv") return "csv";
  if (extension === "xlsx") return "xlsx";
  if (extension === "xls") return "xls";
  if (extension === "xml" || sample.trimStart().startsWith("<")) return "xml";
  if (extension === "json" || /^(?:\{|\[)/.test(sample.trimStart())) return "json";
  return "unknown";
}
