import { createFileRoute } from "@tanstack/react-router";
import { vehicleNames, vehicleSlug, isMake } from "@/data/vehicles";

export const Route = createFileRoute("/avtozapchasti/")({
  component: VehicleDirectory,
  head: () => ({
    meta: [
      { title: "Автозапчастини за маркою та моделлю авто — AJEX" },
      { name: "description", content: "Оберіть марку або модель автомобіля, щоб замовити підбір автозапчастин за VIN. Оригінальні запчастини та перевірені аналоги з доставкою по Україні." },
      { property: "og:title", content: "Каталог автозапчастин за автомобілем — AJEX" },
      { property: "og:description", content: "Знайдіть сторінку своєї марки або моделі та надішліть VIN для точного підбору." },
    ],
    links: [{ rel: "canonical", href: "https://ajex.com.ua/avtozapchasti" }],
  }),
});

function VehicleDirectory() {
  const makes = vehicleNames.filter(isMake);
  return (
    <main className="min-h-screen bg-background px-4 py-12 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <a href="/" className="text-sm font-bold text-primary">AJEX · Головна</a>
        <p className="mt-8 text-xs font-extrabold uppercase tracking-wide text-primary">Каталог за автомобілем</p>
        <h1 className="mt-2 text-3xl font-extrabold sm:text-4xl">Автозапчастини для популярних марок і моделей</h1>
        <p className="mt-4 max-w-3xl leading-7 text-muted-foreground">Оберіть автомобіль, щоб перейти до сторінки підбору. Ми уточнимо рік, модифікацію та VIN, перевіримо сумісність оригінальних деталей і аналогів, а також повідомимо актуальну ціну й наявність.</p>
        <section className="mt-9 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {makes.map((make) => {
            const models = vehicleNames.filter((name) => name.startsWith(`${make} `));
            return <article key={make} className="rounded-xl border border-border bg-card p-5">
              <h2 className="text-lg font-extrabold">{make}</h2>
              <a className="mt-3 inline-block text-sm font-bold text-primary hover:underline" href={`/avtozapchasti/${vehicleSlug(make)}`}>Запчастини {make}</a>
              <div className="mt-4 flex flex-wrap gap-2">
                {models.map((model) => <a key={model} className="rounded-md border border-border px-2.5 py-2 text-xs font-semibold hover:border-primary hover:text-primary" href={`/avtozapchasti/${vehicleSlug(model)}`}>{model}</a>)}
              </div>
            </article>;
          })}
        </section>
        <p className="mt-10 text-sm leading-6 text-muted-foreground">Не знайшли свій автомобіль? Надішліть VIN менеджеру AJEX — допоможемо підібрати запчастину за каталогом.</p>
        <a className="mt-4 inline-flex min-h-11 items-center rounded-md bg-primary px-5 text-sm font-extrabold text-primary-foreground" href="https://t.me/ajexcomua">Підібрати за VIN у Telegram</a>
      </div>
    </main>
  );
}
