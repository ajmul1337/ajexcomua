import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { vehicleNames, vehicleSlug, isMake } from "@/data/vehicles";
import { autocompleteCatalog, searchCatalog } from "@/lib/catalog";
import { listCompatibleVehicleProducts, listVehicleOptions } from "@/lib/vehicle-catalog";

export const Route = createFileRoute("/avtozapchasti/")({
  component: VehicleDirectory,
  head: () => ({
    meta: [
      { title: "Автозапчастини за маркою та моделлю авто — AJEX" },
      {
        name: "description",
        content:
          "Оберіть марку або модель автомобіля, щоб замовити підбір автозапчастин за VIN. Оригінальні запчастини та перевірені аналоги з доставкою по Україні.",
      },
      { property: "og:title", content: "Каталог автозапчастин за автомобілем — AJEX" },
      {
        property: "og:description",
        content: "Знайдіть сторінку своєї марки або моделі та надішліть VIN для точного підбору.",
      },
    ],
    links: [{ rel: "canonical", href: "https://ajex.com.ua/avtozapchasti" }],
  }),
});

function VehicleDirectory() {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<
    Array<{ id: string; brand: string; article: string; name: string }>
  >([]);
  const [results, setResults] = useState<
    Array<{
      id: string;
      brand_name: string;
      article: string;
      name: string;
      price: string;
      stock: string;
      matched_by: string;
      cross_numbers: string[];
    }>
  >([]);
  const [searching, setSearching] = useState(false);
  const [makesOptions, setMakesOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [vehicleSelection, setVehicleSelection] = useState({
    makeId: "",
    modelId: "",
    generationId: "",
    bodyId: "",
    engineId: "",
    modificationId: "",
    categoryId: "",
  });
  const [vehicleOptions, setVehicleOptions] = useState<
    Array<{
      id: string;
      name: string;
      year_from?: number;
      year_to?: number;
      fuel?: string;
      displacement_cc?: number;
      power_kw?: number;
    }>
  >([]);
  const [bodyOptions, setBodyOptions] = useState<typeof vehicleOptions>([]);
  const [engineOptions, setEngineOptions] = useState<typeof vehicleOptions>([]);
  const [vehicleProducts, setVehicleProducts] = useState<
    Array<{
      id: string;
      brand: string;
      article: string;
      name: string;
      price: string;
      stock: string;
      category: string | null;
    }>
  >([]);
  useEffect(() => {
    void listVehicleOptions({ data: { parent: "makes", limit: 100 } }).then((result) =>
      setMakesOptions(result.items as typeof makesOptions),
    );
  }, []);
  const loadVehicleOptions = async (
    parent: "models" | "generations" | "bodies" | "engines" | "modifications",
  ) => {
    const data = {
      parent,
      makeId: vehicleSelection.makeId || undefined,
      modelId: vehicleSelection.modelId || undefined,
      generationId: vehicleSelection.generationId || undefined,
    };
    const result = await listVehicleOptions({ data });
    setVehicleOptions(result.items as typeof vehicleOptions);
  };
  const chooseVehicle = async (field: keyof typeof vehicleSelection, value: string) => {
    const next = { ...vehicleSelection, [field]: value };
    if (field === "makeId")
      Object.assign(next, {
        modelId: "",
        generationId: "",
        bodyId: "",
        engineId: "",
        modificationId: "",
      });
    if (field === "modelId")
      Object.assign(next, { generationId: "", bodyId: "", engineId: "", modificationId: "" });
    if (field === "generationId") Object.assign(next, { bodyId: "", modificationId: "" });
    setVehicleSelection(next);
    if (typeof window !== "undefined") {
      if (Object.values(next).some(Boolean)) {
        window.localStorage.setItem("ajex.selectedVehicle", JSON.stringify(next));
      } else {
        window.localStorage.removeItem("ajex.selectedVehicle");
      }
    }
    setVehicleProducts([]);
    if (field === "makeId") {
      const result = await listVehicleOptions({
        data: { parent: "models", makeId: value, limit: 100 },
      });
      setVehicleOptions(result.items as typeof vehicleOptions);
    }
    if (field === "modelId") {
      const result = await listVehicleOptions({
        data: { parent: "generations", modelId: value, limit: 100 },
      });
      setVehicleOptions(result.items as typeof vehicleOptions);
      const engines = await listVehicleOptions({
        data: { parent: "engines", modelId: value, limit: 100 },
      });
      setEngineOptions(engines.items as typeof engineOptions);
    }
    if (field === "generationId") {
      const [bodies, modifications] = await Promise.all([
        listVehicleOptions({ data: { parent: "bodies", generationId: value, limit: 100 } }),
        listVehicleOptions({ data: { parent: "modifications", generationId: value, limit: 100 } }),
      ]);
      setBodyOptions(bodies.items as typeof bodyOptions);
      setVehicleOptions(modifications.items as typeof vehicleOptions);
    }
    if (field === "bodyId" || field === "engineId") {
      const result = await listVehicleOptions({
        data: {
          parent: "modifications",
          generationId: next.generationId,
          bodyId: next.bodyId || undefined,
          engineId: next.engineId || undefined,
          limit: 100,
        },
      });
      setVehicleOptions(result.items as typeof vehicleOptions);
    }
    if (field === "modificationId") {
      const result = await listCompatibleVehicleProducts({
        data: { modificationId: value, limit: 25, page: 1 },
      });
      setVehicleProducts(result.items as typeof vehicleProducts);
    }
  };
  useEffect(() => {
    if (query.trim().length < 2) {
      setSuggestions([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void autocompleteCatalog({ data: { query: query.trim(), limit: 8 } }).then((response) => {
        setSuggestions(response.items as typeof suggestions);
      });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query]);
  const runSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const response = await searchCatalog({ data: { query: query.trim(), limit: 20 } });
      setResults(response.items as typeof results);
      setSuggestions([]);
    } finally {
      setSearching(false);
    }
  };
  const makes = vehicleNames.filter(isMake);
  return (
    <main className="min-h-screen bg-background px-4 py-12 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <a href="/" className="text-sm font-bold text-primary">
          AJEX · Головна
        </a>
        <p className="mt-8 text-xs font-extrabold uppercase tracking-wide text-primary">
          Каталог за автомобілем
        </p>
        <h1 className="mt-2 text-3xl font-extrabold sm:text-4xl">
          Автозапчастини для популярних марок і моделей
        </h1>
        <p className="mt-4 max-w-3xl leading-7 text-muted-foreground">
          Оберіть автомобіль, щоб перейти до сторінки підбору. Ми уточнимо рік, модифікацію та VIN,
          перевіримо сумісність оригінальних деталей і аналогів, а також повідомимо актуальну ціну й
          наявність.
        </p>
        <section className="relative mt-8 rounded-xl border border-border bg-card p-4 shadow-sm">
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              void runSearch();
            }}
          >
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Артикул, бренд, название, OEM или автомобиль"
              className="h-11 flex-1 rounded-lg border border-input bg-background px-3"
              aria-label="Поиск по каталогу"
            />
            <button
              type="submit"
              className="h-11 rounded-lg bg-primary px-5 text-sm font-bold text-primary-foreground"
            >
              {searching ? "Ищем…" : "Найти"}
            </button>
          </form>
          {suggestions.length > 0 && (
            <ul className="absolute inset-x-4 top-[calc(100%-0.25rem)] z-10 rounded-lg border border-border bg-card p-1 shadow-lg">
              {suggestions.map((suggestion) => (
                <li key={suggestion.id}>
                  <button
                    type="button"
                    className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={() => {
                      setQuery(`${suggestion.brand} ${suggestion.article}`);
                      setSuggestions([]);
                    }}
                  >
                    {suggestion.brand} {suggestion.article}
                    <span className="ml-2 text-muted-foreground">{suggestion.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {results.length > 0 && (
            <div className="mt-4 grid gap-2">
              <h2 className="font-extrabold">Результаты поиска</h2>
              {results.map((result) => (
                <a
                  href={`/catalog/product/${result.id}`}
                  key={result.id}
                  className="block rounded-lg border border-border p-3 text-sm hover:border-primary"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong>
                      {result.brand_name} {result.article}
                    </strong>
                    <span>
                      {Number(result.price).toLocaleString("uk-UA")} ₴ · {result.stock} шт.
                    </span>
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    {result.name} · найдено по: {result.matched_by}
                  </p>
                  {result.cross_numbers?.length > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Кроссы: {result.cross_numbers.join(", ")}
                    </p>
                  )}
                </a>
              ))}
            </div>
          )}
        </section>
        <section className="mt-6 rounded-xl border border-border bg-card p-5 shadow-sm">
          <h2 className="text-lg font-extrabold">Подбор по автомобилю</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <select
              value={vehicleSelection.makeId}
              onChange={(event) => void chooseVehicle("makeId", event.target.value)}
              className="h-10 rounded-lg border border-input bg-background px-3"
            >
              <option value="">Марка</option>
              {makesOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <select
              value={vehicleSelection.modelId}
              onChange={(event) => void chooseVehicle("modelId", event.target.value)}
              disabled={!vehicleSelection.makeId}
              className="h-10 rounded-lg border border-input bg-background px-3"
            >
              <option value="">Модель</option>
              {vehicleOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <select
              value={vehicleSelection.generationId}
              onChange={(event) => void chooseVehicle("generationId", event.target.value)}
              disabled={!vehicleSelection.modelId}
              className="h-10 rounded-lg border border-input bg-background px-3"
            >
              <option value="">Поколение / кузов</option>
              {vehicleOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} {item.year_from ? `(${item.year_from}–${item.year_to ?? ""})` : ""}
                </option>
              ))}
            </select>
            <select
              value={vehicleSelection.bodyId}
              onChange={(event) => void chooseVehicle("bodyId", event.target.value)}
              disabled={!vehicleSelection.generationId}
              className="h-10 rounded-lg border border-input bg-background px-3"
            >
              <option value="">Кузов</option>
              {bodyOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <select
              value={vehicleSelection.engineId}
              onChange={(event) => void chooseVehicle("engineId", event.target.value)}
              disabled={!vehicleSelection.modelId}
              className="h-10 rounded-lg border border-input bg-background px-3"
            >
              <option value="">Двигатель / топливо</option>
              {engineOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
            <select
              value={vehicleSelection.modificationId}
              onChange={(event) => void chooseVehicle("modificationId", event.target.value)}
              disabled={!vehicleSelection.generationId}
              className="h-10 rounded-lg border border-input bg-background px-3"
            >
              <option value="">Модификация / двигатель</option>
              {vehicleOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {item.fuel ? ` · ${item.fuel}` : ""}
                </option>
              ))}
            </select>
          </div>
          {vehicleProducts.length > 0 && (
            <div className="mt-5 grid gap-2">
              <h3 className="font-bold">Совместимые запчасти</h3>
              {vehicleProducts.map((product) => (
                <a
                  href={`/catalog/product/${product.id}`}
                  key={product.id}
                  className="block rounded-lg border border-border p-3 text-sm hover:border-primary"
                >
                  <strong>
                    {product.brand} {product.article}
                  </strong>{" "}
                  · {product.name}
                  <span className="ml-2">
                    {Number(product.price).toLocaleString("uk-UA")} ₴ · {product.stock} шт.
                  </span>
                </a>
              ))}
            </div>
          )}
        </section>
        <section className="mt-9 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {makes.map((make) => {
            const models = vehicleNames.filter((name) => name.startsWith(`${make} `));
            return (
              <article key={make} className="rounded-xl border border-border bg-card p-5">
                <h2 className="text-lg font-extrabold">{make}</h2>
                <a
                  className="mt-3 inline-block text-sm font-bold text-primary hover:underline"
                  href={`/avtozapchasti/${vehicleSlug(make)}`}
                >
                  Запчастини {make}
                </a>
                <div className="mt-4 flex flex-wrap gap-2">
                  {models.map((model) => (
                    <a
                      key={model}
                      className="rounded-md border border-border px-2.5 py-2 text-xs font-semibold hover:border-primary hover:text-primary"
                      href={`/avtozapchasti/${vehicleSlug(model)}`}
                    >
                      {model}
                    </a>
                  ))}
                </div>
              </article>
            );
          })}
        </section>
        <p className="mt-10 text-sm leading-6 text-muted-foreground">
          Не знайшли свій автомобіль? Надішліть VIN менеджеру AJEX — допоможемо підібрати запчастину
          за каталогом.
        </p>
        <a
          className="mt-4 inline-flex min-h-11 items-center rounded-md bg-primary px-5 text-sm font-extrabold text-primary-foreground"
          href="https://t.me/ajexcomua"
        >
          Підібрати за VIN у Telegram
        </a>
      </div>
    </main>
  );
}
