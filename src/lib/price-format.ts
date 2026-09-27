export type PriceColumn =
  | "article"
  | "brand"
  | "name"
  | "price"
  | "stock"
  | "lead_time"
  | "supplier_article"
  | "oem"
  | "weight"
  | "size"
  | "image"
  | "category";
export type PriceColumnMapping = Record<string, string | undefined>;

const headerAliases: Record<PriceColumn, string[]> = {
  article: ["артикул", "кодтовара", "код", "sku", "article", "partnumber", "номердетали", "номер"],
  brand: ["бренд", "производитель", "марка", "brand", "manufacturer", "maker"],
  name: ["название", "наименование", "товар", "описание", "name", "product", "description"],
  price: ["цена", "оптоваяцена", "розничнаяцена", "price", "cost", "amount"],
  stock: ["остаток", "наличие", "количество", "quantity", "qty", "stock", "available"],
  lead_time: ["срокпоставки", "срок", "доставка", "leadtime", "lead_time", "days"],
  supplier_article: [
    "артикулпоставщика",
    "кодпоставщика",
    "supplierarticle",
    "supplier_sku",
    "vendorcode",
  ],
  oem: ["oem", "oe", "оригинальныйномер"],
  weight: ["вес", "вага", "weight"],
  size: ["размер", "розмір", "size", "dimensions"],
  image: ["изображение", "фото", "картинка", "image", "picture"],
  category: ["категория", "категорія", "category"],
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
    const configuredValue = savedMapping[field]?.trim() ?? "";
    const configuredIndex = configuredColumnIndex(configuredValue);
    const configured = configuredValue ? normalizeHeader(configuredValue) : "";
    const matched =
      configuredIndex >= 0
        ? normalizedHeaders[configuredIndex]
        : configured
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
  for (const [field, column] of Object.entries(savedMapping)) {
    if (field in headerAliases || !column?.trim()) continue;
    const index = configuredColumnIndex(column.trim());
    const matched =
      index >= 0
        ? normalizedHeaders[index]
        : normalizedHeaders.find((header) => header.normalized === normalizeHeader(column));
    if (matched) result[field as PriceColumn] = matched.raw;
  }
  return result;
}

function configuredColumnIndex(value: string): number {
  if (/^\d+$/.test(value)) return Number(value) > 0 ? Number(value) - 1 : -1;
  if (!/^[a-z]{1,3}$/i.test(value)) return -1;
  let index = 0;
  for (const letter of value.toUpperCase()) index = index * 26 + letter.charCodeAt(0) - 64;
  return index - 1;
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
