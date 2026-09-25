import { createFileRoute } from "@tanstack/react-router";
import { findVehicle, isMake, vehicleNames, vehicleSlug } from "@/data/vehicles";

const parts = ["кузовні деталі", "фари та ліхтарі", "гальмівні колодки", "амортизатори", "фільтри", "деталі двигуна", "елементи підвіски", "дзеркала", "скло", "масла та рідини"];

export const Route = createFileRoute("/avtozapchasti/$slug")({
  component: VehiclePage,
  head: ({ params }) => {
    const name = findVehicle(params.slug);
    if (!name) return { meta: [{ title: "Сторінку не знайдено — AJEX" }] };
    const title = `Запчастини ${name} — підбір за VIN | AJEX`;
    const description = `Підберемо автозапчастини для ${name} за VIN, роком і модифікацією. Оригінал і перевірені аналоги; ціну та наявність підтвердить менеджер AJEX.`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
      ],
      links: [{ rel: "canonical", href: `https://ajex.com.ua/avtozapchasti/${params.slug}` }],
      scripts: [{
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: title,
          description,
          url: `https://ajex.com.ua/avtozapchasti/${params.slug}`,
          inLanguage: "uk-UA",
          about: { "@type": "Thing", name: `Автозапчастини ${name}` },
        }),
      }],
    };
  },
});

function VehiclePage() {
  const { slug } = Route.useParams();
  const name = findVehicle(slug);
  if (!name) return <main className="mx-auto max-w-3xl px-4 py-20"><h1 className="text-3xl font-extrabold">Автомобіль не знайдено</h1><a className="mt-5 inline-block text-primary" href="/avtozapchasti">Перейти до каталогу</a></main>;
  const make = name.split(" ")[0];
  const related = isMake(name) ? vehicleNames.filter((item) => item.startsWith(`${name} `)) : vehicleNames.filter((item) => item.startsWith(`${make} `) && item !== name).slice(0, 8);
  const message = encodeURIComponent(`Вітаю! Потрібні автозапчастини ${name}. Надішлю VIN, рік і модифікацію для точного підбору.`);
  return (
    <main className="min-h-screen bg-background px-4 py-12 sm:px-6 lg:px-8">
      <article className="mx-auto max-w-4xl">
        <nav className="text-sm text-muted-foreground"><a href="/" className="hover:text-primary">AJEX</a><span className="mx-2">/</span><a href="/avtozapchasti" className="hover:text-primary">Автозапчастини</a><span className="mx-2">/</span>{name}</nav>
        <p className="mt-10 text-xs font-extrabold uppercase tracking-wide text-primary">Підбір запчастин за автомобілем</p>
        <h1 className="mt-2 text-3xl font-extrabold sm:text-5xl">Автозапчастини {name}</h1>
        <p className="mt-5 max-w-3xl text-base leading-7 text-muted-foreground">Потрібні запчастини {name}? Підберемо оригінальні деталі та якісні аналоги з урахуванням року випуску, комплектації й модифікації. Надішліть VIN менеджеру AJEX — він перевірить сумісність, актуальну ціну та наявність перед замовленням.</p>
        <div className="mt-7 flex flex-wrap gap-3"><a className="inline-flex min-h-12 items-center rounded-md bg-primary px-5 text-sm font-extrabold text-primary-foreground" href={`https://t.me/ajexcomua?text=${message}`}>Підібрати за VIN у Telegram</a><a className="inline-flex min-h-12 items-center rounded-md border border-border bg-card px-5 text-sm font-bold" href={`viber://chat?number=%2B380933779031`}>Написати у Viber</a></div>
        <section className="mt-12 rounded-xl border border-border bg-card p-6 sm:p-8">
          <h2 className="text-xl font-extrabold">Які деталі можна підібрати для {name}</h2>
          <p className="mt-3 leading-7 text-muted-foreground">Перевіримо каталожний номер і сумісність потрібної деталі для вашої версії авто. Зокрема, допомагаємо шукати:</p>
          <ul className="mt-5 grid gap-2 sm:grid-cols-2">{parts.map((part) => <li key={part} className="rounded-md bg-muted px-4 py-3 text-sm font-semibold">{part} {name}</li>)}</ul>
          <p className="mt-5 text-sm leading-6 text-muted-foreground">Вартість і наявність залежать від виробника та конкретної модифікації. Менеджер підтвердить ці дані після перевірки запиту.</p>
        </section>
        <section className="mt-10">
          <h2 className="text-xl font-extrabold">Як замовити запчастини {name}</h2>
          <ol className="mt-4 grid gap-3 sm:grid-cols-3">{["Надішліть VIN або дані авто: рік, двигун і модифікацію.", "Менеджер перевірить сумісність і запропонує варіанти.", "Уточніть ціну, наявність та доставку перед оформленням."].map((step, index) => <li key={step} className="rounded-lg border border-border bg-card p-4"><span className="text-xs font-extrabold text-primary">КРОК {index + 1}</span><p className="mt-2 text-sm leading-6">{step}</p></li>)}</ol>
        </section>
        <section className="mt-10 rounded-xl bg-secondary p-6 text-secondary-foreground sm:p-8">
          <h2 className="text-xl font-extrabold">Поширені запитання</h2>
          <h3 className="mt-5 font-bold">Чи можна підібрати деталь лише за моделлю?</h3><p className="mt-2 text-sm leading-6 text-secondary-foreground/70">Модель допоможе почати пошук, але для точного підбору потрібні VIN-код або рік, двигун і комплектація.</p>
          <h3 className="mt-5 font-bold">Чи є запчастини {name} в наявності?</h3><p className="mt-2 text-sm leading-6 text-secondary-foreground/70">Менеджер перевірить актуальну наявність і ціну за конкретним номером деталі перед замовленням.</p>
          <a className="mt-6 inline-flex min-h-11 items-center rounded-md bg-primary px-5 text-sm font-extrabold text-primary-foreground" href={`https://t.me/ajexcomua?text=${message}`}>Запитати менеджера</a>
        </section>
        {related.length > 0 && <section className="mt-10"><h2 className="text-xl font-extrabold">{isMake(name) ? `Моделі ${name}` : `Інші автомобілі ${make}`}</h2><div className="mt-4 flex flex-wrap gap-2">{related.map((item) => <a key={item} className="rounded-md border border-border px-3 py-2 text-sm font-semibold hover:border-primary hover:text-primary" href={`/avtozapchasti/${vehicleSlug(item)}`}>{item}</a>)}</div></section>}
        <a className="mt-10 inline-block text-sm font-bold text-primary hover:underline" href="/avtozapchasti">← Усі марки та моделі</a>
      </article>
    </main>
  );
}
