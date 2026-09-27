import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { getProductDetail } from "@/lib/product-detail";

type ProductDetail = {
  product: {
    id: string;
    brand: string;
    article: string;
    name: string;
    description: string | null;
    price: string;
    stock: string;
    warehouse: string | null;
    supplier: string | null;
    category: string | null;
    image: string | null;
    status: string;
  };
  attributes: Array<{ attribute_key: string; attribute_value: string }>;
  offers: Array<{
    id: string;
    warehouse: string;
    supplier: string | null;
    price: string;
    stock: string;
    lead_time_days: number | null;
    supplier_article: string | null;
    status: string;
    updated_at: string | Date;
  }>;
  oems: Array<{ brand: string | null; article: string }>;
  alternatives: Array<{
    product_id: string;
    brand: string;
    article: string;
    name: string;
    price: string;
    stock: string;
  }>;
  compatibility: Array<{
    make: string | null;
    model: string | null;
    model_id: string | null;
    generation_id: string | null;
    body_id: string | null;
    engine_id: string | null;
    modification_id: string | null;
    generation: string | null;
    body: string | null;
    engine: string | null;
    fuel: string | null;
    displacement_cc: number | null;
    power_kw: number | null;
    modification: string | null;
    year_from: number | null;
    year_to: number | null;
    notes: string | null;
  }>;
};

export const Route = createFileRoute("/catalog/product/$id")({ component: ProductPage });

function ProductPage() {
  const { id } = Route.useParams();
  const [data, setData] = useState<ProductDetail | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    void getProductDetail({ data: { id } })
      .then((result) => {
        if (!cancelled) setData(result.product as ProductDetail | null);
      })
      .catch(() => {
        if (!cancelled) setError("Не удалось загрузить карточку товара.");
      });
    return () => {
      cancelled = true;
    };
  }, [id]);
  if (error)
    return (
      <main className="mx-auto max-w-4xl px-4 py-16">
        <p className="text-destructive">{error}</p>
      </main>
    );
  if (!data)
    return (
      <main className="mx-auto max-w-4xl px-4 py-16">
        <p className="text-muted-foreground">Загружаем товар…</p>
      </main>
    );
  const { product, attributes, offers, oems, alternatives, compatibility } = data;
  const selectedVehicle = (() => {
    if (typeof window === "undefined") return null;
    try {
      const parsed: unknown = JSON.parse(
        window.localStorage.getItem("ajex.selectedVehicle") ?? "null",
      );
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  })();
  const selectedVehicleMatches =
    selectedVehicle !== null &&
    compatibility.some(
      (fitment) =>
        (selectedVehicle["modificationId"] &&
          fitment.modification_id === selectedVehicle["modificationId"]) ||
        (selectedVehicle["generationId"] &&
          fitment.generation_id === selectedVehicle["generationId"]) ||
        (selectedVehicle["bodyId"] && fitment.body_id === selectedVehicle["bodyId"]) ||
        (selectedVehicle["engineId"] && fitment.engine_id === selectedVehicle["engineId"]) ||
        (selectedVehicle["modelId"] && fitment.model_id === selectedVehicle["modelId"]),
    );
  return (
    <main className="min-h-screen bg-background px-4 py-10 sm:px-6 lg:px-8">
      <article className="mx-auto max-w-6xl">
        <a href="/avtozapchasti" className="text-sm font-bold text-primary">
          ← Каталог
        </a>
        <section className="mt-6 grid gap-6 rounded-xl border border-border bg-card p-6 lg:grid-cols-[1fr_1.3fr]">
          <div className="rounded-lg bg-muted p-6">
            {product.image ? (
              <img
                src={product.image}
                alt={product.name}
                className="mx-auto max-h-80 object-contain"
              />
            ) : (
              <div className="flex min-h-64 items-center justify-center text-muted-foreground">
                Фото товара отсутствует
              </div>
            )}
          </div>
          <div>
            <p className="text-sm font-bold uppercase tracking-wide text-primary">
              {product.brand}
            </p>
            <h1 className="mt-2 text-3xl font-extrabold">{product.name}</h1>
            <p className="mt-2 text-sm text-muted-foreground">Артикул: {product.article}</p>
            <p className="mt-5 text-3xl font-extrabold">
              {Number(product.price).toLocaleString("uk-UA")} ₴
            </p>
            <p className="mt-2 text-sm">
              Наличие: {product.stock} шт. · {product.warehouse ?? "склад не указан"}
            </p>
            {selectedVehicleMatches && (
              <p className="mt-4 rounded-lg bg-primary/10 p-3 text-sm font-bold text-primary">
                Подходит для вашего автомобиля
              </p>
            )}
            {product.description && (
              <p className="mt-5 leading-7 text-muted-foreground">{product.description}</p>
            )}
          </div>
        </section>
        <section className="mt-6 grid gap-6 lg:grid-cols-2">
          <InfoBlock title="Основная информация">
            <dl className="grid gap-2 text-sm">
              <dt>Производитель</dt>
              <dd className="font-bold">{product.supplier ?? product.brand}</dd>
              <dt>Категория</dt>
              <dd>{product.category ?? "—"}</dd>
              <dt>Статус</dt>
              <dd>{product.status}</dd>
            </dl>
          </InfoBlock>
          <InfoBlock title="Характеристики">
            {attributes.length ? (
              <dl className="grid gap-2 text-sm">
                {attributes.map((attribute) => (
                  <div
                    key={attribute.attribute_key}
                    className="flex justify-between gap-4 border-b border-border pb-2"
                  >
                    <dt>{attribute.attribute_key}</dt>
                    <dd className="font-semibold">{attribute.attribute_value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">Характеристики не указаны.</p>
            )}
          </InfoBlock>
        </section>
        <InfoBlock title="OEM и кроссы">
          {oems.length ? (
            <div className="flex flex-wrap gap-2">
              {oems.map((oem) => (
                <span
                  key={`${oem.brand}-${oem.article}`}
                  className="rounded-md bg-muted px-3 py-2 text-sm"
                >
                  {oem.brand ? `${oem.brand} ` : ""}
                  {oem.article}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">OEM и кроссы не указаны.</p>
          )}
        </InfoBlock>
        <InfoBlock title="Совместимость">
          {compatibility.length ? (
            <ul className="grid gap-2 text-sm sm:grid-cols-2">
              {compatibility.map((fitment, index) => (
                <li
                  key={`${fitment.make}-${fitment.model}-${index}`}
                  className="rounded-lg bg-muted p-3"
                >
                  {[
                    fitment.make,
                    fitment.model,
                    fitment.generation,
                    fitment.body,
                    fitment.modification,
                    fitment.engine,
                    fitment.fuel,
                  ]
                    .filter(Boolean)
                    .join(" · ")}{" "}
                  {(fitment.year_from || fitment.year_to) &&
                    `(${fitment.year_from ?? ""}–${fitment.year_to ?? ""})`}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Совместимость не указана.</p>
          )}
        </InfoBlock>
        <InfoBlock title="Другие предложения складов">
          {offers.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="p-2">Склад</th>
                    <th className="p-2">Поставщик</th>
                    <th className="p-2">Цена</th>
                    <th className="p-2">Наличие</th>
                    <th className="p-2">Срок</th>
                    <th className="p-2">Обновлено</th>
                  </tr>
                </thead>
                <tbody>
                  {offers.map((offer) => (
                    <tr key={offer.id} className="border-b border-border">
                      <td className="p-2">{offer.warehouse}</td>
                      <td className="p-2">{offer.supplier ?? "—"}</td>
                      <td className="p-2 font-bold">
                        {Number(offer.price).toLocaleString("uk-UA")} ₴
                      </td>
                      <td className="p-2">{offer.stock}</td>
                      <td className="p-2">
                        {offer.lead_time_days == null ? "—" : `${offer.lead_time_days} дн.`}
                      </td>
                      <td className="p-2 text-muted-foreground">
                        {new Date(offer.updated_at).toLocaleDateString("uk-UA")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Других предложений нет.</p>
          )}
        </InfoBlock>
        <InfoBlock title="Аналоги">
          {alternatives.length ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {alternatives.map((alternative) => (
                <a
                  key={alternative.product_id}
                  href={`/catalog/product/${alternative.product_id}`}
                  className="rounded-lg border border-border p-3 hover:border-primary"
                >
                  <strong>
                    {alternative.brand} {alternative.article}
                  </strong>
                  <span className="block text-sm text-muted-foreground">
                    {alternative.name} · {Number(alternative.price).toLocaleString("uk-UA")} ₴ ·{" "}
                    {alternative.stock} шт.
                  </span>
                </a>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Аналоги не найдены.</p>
          )}
        </InfoBlock>
      </article>
    </main>
  );
}

function InfoBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6 rounded-xl border border-border bg-card p-6">
      <h2 className="text-xl font-extrabold">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}
