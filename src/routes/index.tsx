import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowRight,
  BadgeCheck,
  BatteryCharging,
  Car,
  ChevronDown,
  CircleDot,
  Clock3,
  Disc3,
  Filter,
  Gauge,
  Headphones,
  Instagram,
  MapPin,
  Menu,
  MessageCircle,
  PackageCheck,
  Phone,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  UserRound,
  Wrench,
  X,
} from "lucide-react";
import heroImage from "@/assets/ajex-hero.jpg";
import ajexLogo from "@/assets/ajex-logo.png";
import ajexLogoFooter from "@/assets/ajex-logo-footer.png";
import brakePads from "@/assets/brake-pads.jpg";
import oilFilter from "@/assets/oil-filter.jpg";
import shockAbsorber from "@/assets/shock-absorber.jpg";
import { getAdminStatus } from "@/lib/admin-auth";

const TELEGRAM = "https://t.me/ajexcomua";
const VIBER = "viber://chat?number=%2B380933779031";
const PHONE = "tel:+380735251029";
const MAP_URL =
  "https://www.google.com/maps/place/AJEX.COM.UA+%E2%80%94+%D0%86%D0%BD%D1%82%D0%B5%D1%80%D0%BD%D0%B5%D1%82-%D0%BC%D0%B0%D0%B3%D0%B0%D0%B7%D0%B8%D0%BD+%D0%B0%D0%B2%D1%82%D0%BE%D0%B7%D0%B0%D0%BF%D1%87%D0%B0%D1%81%D1%82%D0%B8%D0%BD/@50.4962445,30.6173444,17.5z/data=!4m6!3m5!1s0x40d4d14f2ce19167:0x6a2d9fd2435be61!8m2!3d50.4961635!4d30.617954!16s%2Fg%2F11zgr0wtx9?hl=ru-RU&entry=ttu&g_ep=EgoyMDI2MDkyMS4wIKXMDSoASAFQAw%3D%3D";
const MAP_EMBED_URL = "https://www.google.com/maps?q=50.4961635,30.617954&z=18&output=embed";
const CAR_BRANDS = [
  "ACURA",
  "ALFA ROMEO",
  "AUDI",
  "BMW",
  "CHERY",
  "CHEVROLET",
  "CITROEN",
  "DACIA",
  "DAEWOO",
  "DAIHATSU",
  "FIAT",
  "FORD",
  "GEELY",
  "HONDA",
  "HUMMER",
  "HYUNDAI",
  "INFINITI",
  "JEEP",
  "KIA",
  "LADA",
  "LAND ROVER",
  "LEXUS",
  "MAZDA",
  "MERCEDES-BENZ",
  "MITSUBISHI",
  "MOSKVICH",
  "NISSAN",
  "OPEL",
  "PEUGEOT",
  "PORSCHE",
  "RENAULT",
  "SEAT",
  "SKODA",
  "SMART",
  "SSANGYONG",
  "SUBARU",
  "SUZUKI",
  "TOYOTA",
  "VOLVO",
  "VW",
];

export const Route = createFileRoute("/")({
  component: Index,
  head: () => ({
    meta: [
      { title: "Автозапчастини з підбором за VIN у Києві — AJEX" },
      {
        name: "description",
        content:
          "Підберемо оригінальні автозапчастини та якісні аналоги за VIN, маркою і моделлю. Майже 10 років досвіду, доставка по Україні. AJEX, Київ.",
      },
      { property: "og:title", content: "AJEX — точний підбір автозапчастин за VIN" },
      {
        property: "og:description",
        content: "Надішліть VIN менеджеру та отримайте варіанти запчастин з цінами.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "/" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "/" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "AutoPartsStore",
          name: "AJEX",
          url: "https://ajex.com.ua/",
          telephone: "+380735251029",
          address: {
            "@type": "PostalAddress",
            streetAddress: "вул. Крайня, 13",
            addressLocality: "Київ",
            addressCountry: "UA",
          },
          sameAs: ["https://t.me/ajexcomua", "https://www.instagram.com/ajmal_stelit/"],
        }),
      },
    ],
  }),
});

type ActionProps = {
  href: string;
  children: ReactNode;
  variant?: "gold" | "navy" | "outline" | "ghost";
  className?: string;
};
function Action({ href, children, variant = "gold", className = "" }: ActionProps) {
  const styles = {
    gold: "bg-primary text-primary-foreground hover:bg-primary/90",
    navy: "bg-secondary text-secondary-foreground hover:bg-navy-soft",
    outline: "border border-border bg-card text-foreground hover:bg-muted",
    ghost: "text-secondary-foreground hover:bg-secondary-foreground/10",
  };
  return (
    <a
      href={href}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-bold transition-colors focus-visible:ring-2 focus-visible:ring-ring ${styles[variant]} ${className}`}
      target={href.startsWith("http") ? "_blank" : undefined}
      rel={href.startsWith("http") ? "noreferrer" : undefined}
    >
      {children}
    </a>
  );
}

const categories = [
  ["Гальмівні колодки", Disc3],
  ["Гальмівні диски", CircleDot],
  ["Амортизатори", Gauge],
  ["Повітряні фільтри", Filter],
  ["Масляні фільтри", Settings2],
  ["Салонні фільтри", Filter],
  ["Ремені ГРМ", Wrench],
  ["Свічки запалювання", Sparkles],
  ["Рульові наконечники", Settings2],
  ["Сайлентблоки", CircleDot],
  ["Акумулятори", BatteryCharging],
  ["Кульові опори", Wrench],
] as const;

const products = [
  {
    name: "Гальмівні колодки",
    brand: "Перевірений аналог",
    code: "BP-1048",
    price: "від 1 240 ₴",
    image: brakePads,
  },
  {
    name: "Масляний фільтр",
    brand: "Преміум серія",
    code: "OF-2210",
    price: "від 320 ₴",
    image: oilFilter,
  },
  {
    name: "Амортизатор задній",
    brand: "OEM стандарт",
    code: "SA-9012",
    price: "від 2 180 ₴",
    image: shockAbsorber,
  },
] as const;

function Picker() {
  const [mode, setMode] = useState<"auto" | "vin" | "plate">("auto");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");
  const [engine, setEngine] = useState("");
  const [parts, setParts] = useState("");
  const [query, setQuery] = useState("");

  const send = (event: FormEvent) => {
    event.preventDefault();
    const details =
      mode === "auto"
        ? `Авто: ${brand}, модель: ${model}, рік: ${year}, двигун: ${engine}. Потрібні запчастини: ${parts}`
        : `${mode === "vin" ? "VIN" : "Держномер"}: ${query}`;
    window.open(
      `${TELEGRAM}?text=${encodeURIComponent(`Вітаю! Потрібна допомога з підбором запчастин. ${details}`)}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  return (
    <section id="selection" className="relative z-10 mx-auto -mt-12 max-w-7xl px-4 sm:px-6 lg:px-8">
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
        <div className="flex flex-col justify-between gap-4 border-b border-border pb-5 lg:flex-row lg:items-center">
          <div>
            <p className="text-xs font-bold uppercase text-primary">Точний пошук</p>
            <h2 className="mt-1 text-xl font-extrabold text-foreground sm:text-2xl">
              Підбір запчастин
            </h2>
          </div>
          <div
            className="grid grid-cols-3 rounded-lg bg-muted p-1"
            role="tablist"
            aria-label="Спосіб підбору"
          >
            {(
              [
                ["auto", "За авто"],
                ["vin", "За VIN"],
                ["plate", "За номером"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setMode(id)}
                className={`min-h-10 rounded-md px-3 text-xs font-bold transition-colors sm:px-5 sm:text-sm ${mode === id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                aria-selected={mode === id}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <form onSubmit={send} className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {mode === "auto" ? (
            <>
              <label className="relative">
                <span className="sr-only">Марка</span>
                <select
                  required
                  value={brand}
                  onChange={(e) => {
                    setBrand(e.target.value);
                    setModel("");
                    setYear("");
                    setEngine("");
                    setParts("");
                  }}
                  className="h-12 w-full appearance-none rounded-md border border-input bg-card px-4 pr-10 text-sm font-semibold"
                >
                  <option value="">Марка автомобіля</option>
                  {CAR_BRANDS.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-4 size-4 text-muted-foreground" />
              </label>
              {brand && (
                <input
                  required
                  autoFocus
                  value={model}
                  onChange={(e) => {
                    setModel(e.target.value);
                    setYear("");
                    setEngine("");
                    setParts("");
                  }}
                  className="h-12 rounded-md border border-input bg-card px-4 text-sm font-semibold"
                  placeholder="Модель"
                />
              )}
              {model.trim() && (
                <input
                  required
                  value={year}
                  onChange={(e) => {
                    setYear(e.target.value);
                    setEngine("");
                    setParts("");
                  }}
                  className="h-12 rounded-md border border-input bg-card px-4 text-sm font-semibold"
                  placeholder="Рік випуску"
                />
              )}
              {year.trim() && (
                <input
                  required
                  value={engine}
                  onChange={(e) => {
                    setEngine(e.target.value);
                    setParts("");
                  }}
                  className="h-12 rounded-md border border-input bg-card px-4 text-sm font-semibold"
                  placeholder="Двигун"
                />
              )}
              {engine.trim() && (
                <textarea
                  required
                  value={parts}
                  onChange={(e) => setParts(e.target.value)}
                  className="min-h-12 rounded-md border border-input bg-card px-4 py-3 text-sm font-semibold sm:col-span-2 lg:col-span-3"
                  placeholder="Яка запчастина потрібна? Наприклад: передні гальмівні колодки, масло, масляний фільтр"
                  rows={2}
                />
              )}
            </>
          ) : (
            <input
              required
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value.toUpperCase())}
              className="h-12 rounded-md border border-input bg-card px-4 text-sm font-semibold uppercase sm:col-span-2 lg:col-span-3"
              placeholder={
                mode === "vin" ? "Введіть 17 символів VIN-коду" : "Введіть державний номер"
              }
              maxLength={mode === "vin" ? 17 : 10}
            />
          )}
          <button
            type="submit"
            className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-primary px-7 text-sm font-extrabold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Search className="size-4" /> Знайти
          </button>
        </form>
        <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="size-4 text-success" /> Дані авто потрібні лише для точного
          підбору
        </p>
      </div>
    </section>
  );
}

function AdminPanelLink({ mobile = false, topBar = false }: { mobile?: boolean; topBar?: boolean }) {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let active = true;
    getAdminStatus()
      .then((status) => {
        if (active) setIsAdmin(status.authenticated && status.role === "admin");
      })
      .catch(() => {
        if (active) setIsAdmin(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <a
      href={isAdmin ? "/admin/" : "/admin/login"}
      className={
        topBar
          ? "inline-flex min-h-6 shrink-0 items-center gap-1 rounded border border-secondary-foreground/25 px-2 py-1 text-[10px] font-bold whitespace-nowrap transition-colors hover:border-primary hover:text-primary sm:text-[11px]"
          : mobile
          ? "rounded-md px-3 py-3 font-bold text-primary hover:bg-muted"
          : "inline-flex min-h-11 items-center rounded-md border border-border px-3 text-xs font-bold text-foreground hover:border-primary hover:text-primary"
      }
    >
      {topBar && <UserRound className="size-3.5" />}
      {isAdmin ? "Адмін-панель" : "Войти"}
    </a>
  );
}

function Index() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  return (
    <div className="min-h-screen bg-background">
      <div className="bg-secondary text-secondary-foreground">
        <div className="mx-auto flex min-h-8 max-w-7xl items-center justify-between gap-4 px-4 text-[11px] font-medium sm:px-6 lg:px-8">
          <div className="flex items-center gap-5">
            <a
              href={MAP_URL}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 hover:text-primary"
            >
              <MapPin className="size-3.5" /> Київ, вул. Крайня, 13
            </a>
            <span className="hidden items-center gap-1.5 sm:flex">
              <Clock3 className="size-3.5" /> Пн–Пт 09:00–18:00
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-4">
            <a href={PHONE} className="hidden items-center gap-1.5 whitespace-nowrap font-bold hover:text-primary min-[420px]:flex">
              <Phone className="size-3.5" /> +38 073 525 10 29
            </a>
            <AdminPanelLink topBar />
          </div>
        </div>
      </div>
      <header className="sticky top-0 z-40 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex h-18 max-w-7xl items-center justify-between gap-6 px-4 sm:px-6 lg:px-8">
          <a href="#top" className="flex items-center" aria-label="AJEX — на головну">
            <img src={ajexLogo} alt="AJEX" className="h-9 w-auto max-w-[150px] object-contain" />
          </a>
          <nav className="hidden items-center gap-7 text-sm font-semibold text-foreground lg:flex">
            <a href="#selection" className="hover:text-primary">
              Підбір запчастин
            </a>
            <a href="#categories" className="hover:text-primary">
              Категорії
            </a>
            <a href="#products" className="hover:text-primary">
              Популярне
            </a>
            <a href="#about" className="hover:text-primary">
              Про нас
            </a>
            <a href="#contacts" className="hover:text-primary">
              Контакти
            </a>
          </nav>
          <div className="hidden items-center gap-2 sm:flex">
            <Action href={TELEGRAM} variant="navy">
              <MessageCircle className="size-4" /> Написати в Telegram
            </Action>
            <Action href="https://ajex.com.ua/" variant="outline">
              Каталог <ArrowRight className="size-4" />
            </Action>
          </div>
          <button
            type="button"
            className="grid size-11 place-items-center rounded-md border border-border lg:hidden"
            onClick={() => setMenuOpen(!menuOpen)}
            aria-label="Відкрити меню"
          >
            {menuOpen ? <X /> : <Menu />}
          </button>
        </div>
        {menuOpen && (
          <nav className="border-t border-border bg-card p-4 lg:hidden">
            <div className="mx-auto grid max-w-7xl gap-1 text-sm font-semibold">
              {[
                ["#selection", "Підбір запчастин"],
                ["#categories", "Категорії"],
                ["#products", "Популярне"],
                ["#about", "Про нас"],
                ["#contacts", "Контакти"],
              ].map(([href, label]) => (
                <a
                  key={href}
                  href={href}
                  onClick={() => setMenuOpen(false)}
                  className="rounded-md px-3 py-3 hover:bg-muted"
                >
                  {label}
                </a>
              ))}
              <AdminPanelLink mobile />
            </div>
          </nav>
        )}
      </header>

      <main id="top">
        <section className="relative min-h-[620px] overflow-hidden bg-secondary sm:min-h-[650px]">
          <img
            src={heroImage}
            alt="Гальмівний диск, фільтр, мастило та деталі підвіски"
            width={1600}
            height={900}
            className="absolute inset-0 h-full w-full object-cover object-[64%_center] opacity-55 sm:opacity-75"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-secondary via-secondary/95 to-secondary/5" />
          <div className="relative mx-auto flex min-h-[570px] max-w-7xl items-center px-4 pb-16 pt-12 sm:min-h-[600px] sm:px-6 lg:px-8">
            <div className="max-w-2xl text-secondary-foreground">
              <div className="mb-5 inline-flex items-center gap-2 rounded-md border border-secondary-foreground/20 bg-secondary/60 px-3 py-2 text-xs font-bold">
                <BadgeCheck className="size-4 text-primary" /> VIN-підбір — перевірка сумісності
              </div>
              <h1 className="max-w-xl text-4xl font-extrabold leading-[1.08] sm:text-5xl lg:text-6xl">
                Запчастини без помилок і переплат
              </h1>
              <p className="mt-5 max-w-xl text-base leading-7 text-secondary-foreground/75 sm:text-lg">
                Надішліть VIN-код або дані автомобіля. Перевіримо сумісність, знайдемо потрібну
                деталь та запропонуємо оригінал або якісний аналог.
              </p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <Action
                  href={`${TELEGRAM}?text=${encodeURIComponent("Вітаю! Потрібен VIN-підбір")}`}
                  className="sm:min-w-52"
                >
                  <MessageCircle className="size-5" /> Підібрати за VIN у Telegram
                </Action>
                <Action
                  href="https://ajex.com.ua/"
                  variant="ghost"
                  className="border border-secondary-foreground/25"
                >
                  Знайти в каталозі <ArrowRight className="size-4" />
                </Action>
              </div>
              <div className="mt-8 grid max-w-lg grid-cols-3 divide-x divide-secondary-foreground/20 border-t border-secondary-foreground/20 pt-5">
                <div>
                  <strong className="block text-xl">10+ років</strong>
                  <span className="text-xs text-secondary-foreground/60">
                    Досвіду в автозапчастинах
                  </span>
                </div>
                <div className="pl-4">
                  <strong className="block text-xl">VIN-підбір</strong>
                  <span className="text-xs text-secondary-foreground/60">Перевірка сумісності</span>
                </div>
                <div className="pl-4">
                  <strong className="block text-xl">По всій Україні</strong>
                  <span className="text-xs text-secondary-foreground/60">Відправлення щодня</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <Picker />

        <section id="categories" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="mb-6 flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-extrabold uppercase text-primary">Швидкий перехід</p>
              <h2 className="mt-1 text-2xl font-extrabold sm:text-3xl">Популярні категорії</h2>
            </div>
            <a
              href="https://ajex.com.ua/"
              target="_blank"
              rel="noreferrer"
              className="hidden items-center gap-2 text-sm font-bold hover:text-primary sm:flex"
            >
              Весь каталог <ArrowRight className="size-4" />
            </a>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {categories.map(([name, Icon]) => (
              <a
                key={name}
                href={`${TELEGRAM}?text=${encodeURIComponent(`Вітаю! Цікавить категорія: ${name}`)}`}
                target="_blank"
                rel="noreferrer"
                className="group min-h-28 rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary"
              >
                <Icon className="size-5 text-primary" />
                <span className="mt-5 block text-sm font-bold leading-5 group-hover:text-primary">
                  {name}
                </span>
              </a>
            ))}
          </div>
        </section>

        <section id="products" className="border-y border-border bg-card py-16">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mb-6">
              <p className="text-xs font-extrabold uppercase text-primary">Часто шукають</p>
              <h2 className="mt-1 text-2xl font-extrabold sm:text-3xl">Популярні запчастини</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Актуальну сумісність, ціну та наявність підтвердить менеджер.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              {products.map((product) => (
                <article
                  key={product.name}
                  className="group grid grid-cols-[140px_1fr] overflow-hidden rounded-lg border border-border bg-card sm:grid-cols-[180px_1fr] md:block"
                >
                  <div className="relative aspect-square overflow-hidden bg-muted">
                    <span className="absolute left-3 top-3 z-10 rounded bg-success-soft px-2 py-1 text-[10px] font-extrabold text-success">
                      В НАЯВНОСТІ
                    </span>
                    <img
                      src={product.image}
                      alt={product.name}
                      loading="lazy"
                      width={816}
                      height={816}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  </div>
                  <div className="flex flex-col justify-center p-4 sm:p-5">
                    <p className="text-xs font-semibold text-muted-foreground">
                      {product.brand} · {product.code}
                    </p>
                    <h3 className="mt-1 font-extrabold">{product.name}</h3>
                    <p className="mt-3 text-lg font-extrabold text-secondary">{product.price}</p>
                    <a
                      href={`${TELEGRAM}?text=${encodeURIComponent(`Вітаю! Потрібен підбір: ${product.name}, код ${product.code}`)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-foreground hover:text-primary"
                    >
                      Уточнити для мого авто <ArrowRight className="size-4" />
                    </a>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto grid max-w-7xl grid-cols-2 gap-px border-x border-b border-border bg-border sm:grid-cols-4">
          <div className="bg-background p-5 sm:p-6">
            <ShieldCheck className="size-6 text-primary" />
            <strong className="mt-4 block text-sm">100% оригінал</strong>
            <span className="text-xs text-muted-foreground">Перевірені постачальники</span>
          </div>
          <div className="bg-background p-5 sm:p-6">
            <PackageCheck className="size-6 text-primary" />
            <strong className="mt-4 block text-sm">Швидка доставка</strong>
            <span className="text-xs text-muted-foreground">По всій Україні</span>
          </div>
          <div className="bg-background p-5 sm:p-6">
            <Car className="size-6 text-primary" />
            <strong className="mt-4 block text-sm">Підбір за VIN</strong>
            <span className="text-xs text-muted-foreground">Без ризику помилки</span>
          </div>
          <div className="bg-background p-5 sm:p-6">
            <Headphones className="size-6 text-primary" />
            <strong className="mt-4 block text-sm">Жива підтримка</strong>
            <span className="text-xs text-muted-foreground">Менеджер на зв’язку</span>
          </div>
        </section>

        <section
          id="about"
          className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:px-8"
        >
          <div>
            <p className="text-xs font-extrabold uppercase text-primary">Експертно і чесно</p>
            <h2 className="mt-2 text-3xl font-extrabold leading-tight">
              Розбираємося в деталях, щоб ви не переплачували
            </h2>
            <p className="mt-4 leading-7 text-muted-foreground">
              У блозі AJEX пояснюємо різницю між оригінальними запчастинами й аналогами, показуємо,
              від чого залежить ціна та як зробити правильний вибір.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Action href="https://www.instagram.com/ajmal_stelit/" variant="navy">
                <Instagram className="size-4" /> @ajmal_stelit
              </Action>
              <Action href={TELEGRAM} variant="outline">
                <MessageCircle className="size-4" /> Поставити питання
              </Action>
            </div>
          </div>
          <div className="aspect-video overflow-hidden rounded-xl border border-border bg-secondary shadow-sm">
            <iframe
              className="h-full w-full"
              src="https://www.youtube.com/embed/8Zb921zzyz4"
              title="Ціна дорівнює якість? Пояснення AJEX"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
              loading="lazy"
            />
          </div>
        </section>

        <section className="bg-secondary py-12 text-secondary-foreground">
          <div className="mx-auto flex max-w-7xl flex-col justify-between gap-7 px-4 sm:px-6 lg:flex-row lg:items-center lg:px-8">
            <div>
              <p className="text-xs font-extrabold uppercase text-primary">Відповімо особисто</p>
              <h2 className="mt-2 text-2xl font-extrabold sm:text-3xl">
                Потрібна допомога в підборі?
              </h2>
              <p className="mt-2 max-w-2xl text-sm text-secondary-foreground/65">
                Надішліть VIN-код у Telegram або Viber — підберемо варіанти, перевіримо наявність і
                напишемо ціни.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Action href={TELEGRAM}>
                <MessageCircle className="size-5" /> Telegram
              </Action>
              <Action
                href={VIBER}
                variant="ghost"
                className="border border-secondary-foreground/25"
              >
                <Phone className="size-4" /> Viber
              </Action>
            </div>
          </div>
        </section>

        <section
          id="contacts"
          className="mx-auto grid max-w-7xl gap-8 px-4 py-16 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:px-8"
        >
          <div>
            <p className="text-xs font-extrabold uppercase text-primary">Контакти</p>
            <h2 className="mt-2 text-3xl font-extrabold">AJEX у Києві</h2>
            <div className="mt-7 space-y-5 text-sm">
              <a href={MAP_URL} target="_blank" rel="noreferrer" className="flex gap-3">
                <MapPin className="size-5 shrink-0 text-primary" />
                <span>
                  <strong className="block">вул. Крайня, 13</strong>
                  <span className="text-muted-foreground">Прокласти маршрут у Google Maps</span>
                </span>
              </a>
              <a href={PHONE} className="flex gap-3">
                <Phone className="size-5 shrink-0 text-primary" />
                <span>
                  <strong className="block">+38 073 525 10 29</strong>
                  <span className="text-muted-foreground">Телефон для консультації</span>
                </span>
              </a>
              <a href={TELEGRAM} target="_blank" rel="noreferrer" className="flex gap-3">
                <MessageCircle className="size-5 shrink-0 text-primary" />
                <span>
                  <strong className="block">@ajexcomua</strong>
                  <span className="text-muted-foreground">Основний канал для підбору</span>
                </span>
              </a>
            </div>
          </div>
          <div className="min-h-80 overflow-hidden rounded-xl border border-border bg-muted">
            <iframe
              title="AJEX на карті"
              src={MAP_EMBED_URL}
              className="h-full min-h-80 w-full"
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
            />
          </div>
        </section>

        <section className="border-t border-border bg-card py-14">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
              <div>
                <p className="text-xs font-extrabold uppercase text-primary">
                  Для вашого автомобіля
                </p>
                <h2 className="mt-2 text-2xl font-extrabold">Запчастини для популярних марок</h2>
                <a
                  href="/avtozapchasti"
                  className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-primary hover:underline"
                >
                  Усі марки та моделі <ArrowRight className="size-4" />
                </a>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm font-semibold sm:grid-cols-4">
                {[
                  "Toyota",
                  "Volkswagen",
                  "BMW",
                  "Mercedes",
                  "Skoda",
                  "Renault",
                  "Ford",
                  "Hyundai",
                  "Kia",
                  "Nissan",
                  "Opel",
                  "Mazda",
                  "Honda",
                  "Lada",
                  "Chevrolet",
                ].map((brand) => (
                  <a
                    key={brand}
                    href={`/avtozapchasti/${brand.toLowerCase()}`}
                    className="rounded-md border border-border px-3 py-2.5 hover:border-primary hover:text-primary"
                  >
                    Автозапчастини {brand}
                  </a>
                ))}
              </div>
            </div>
            <p className="mt-8 max-w-4xl text-sm leading-7 text-muted-foreground">
              AJEX допомагає купити оригінальні автозапчастини та якісні аналоги для європейських,
              японських і корейських автомобілів. Підбір виконуємо за VIN-кодом, маркою, моделлю,
              роком випуску та модифікацією двигуна. Працюємо з ELIT, Autotechnics, Forma Parts та
              Autonova-D. Доставляємо замовлення по Україні.
            </p>
          </div>
        </section>
      </main>

      <footer className="bg-secondary py-10 text-secondary-foreground">
        <div className="mx-auto flex max-w-7xl flex-col justify-between gap-7 px-4 sm:px-6 lg:flex-row lg:items-end lg:px-8">
          <div>
            <div>
              <img
                src={ajexLogoFooter}
                alt="AJEX"
                className="h-8 w-auto max-w-[135px] object-contain"
              />
            </div>
            <p className="mt-3 max-w-md text-xs leading-5 text-secondary-foreground/60">
              Оригінальні автозапчастини та перевірені аналоги з професійним підбором.
            </p>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-3 text-xs font-semibold">
            <a href={TELEGRAM} target="_blank" rel="noreferrer" className="hover:text-primary">
              Telegram
            </a>
            <a href={VIBER} className="hover:text-primary">
              Viber
            </a>
            <a
              href="https://www.instagram.com/ajmal_stelit/"
              target="_blank"
              rel="noreferrer"
              className="hover:text-primary"
            >
              Instagram
            </a>
            <a
              href="https://ajex.com.ua/"
              target="_blank"
              rel="noreferrer"
              className="hover:text-primary"
            >
              Каталог
            </a>
          </div>
          <p className="text-[11px] text-secondary-foreground/45">
            © 2026 AJEX. Всі права захищені.
          </p>
        </div>
      </footer>
      {contactOpen && (
        <div
          className="fixed bottom-24 right-4 z-50 w-64 rounded-xl border border-border bg-card p-3 shadow-xl sm:bottom-24 sm:right-6"
          aria-label="Варіанти зв’язку"
        >
          <a
            href={TELEGRAM}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-semibold hover:bg-muted"
          >
            <MessageCircle className="size-5 text-primary" />
            <span>
              Telegram <span className="block text-xs text-muted-foreground">@ajexcomua</span>
            </span>
          </a>
          <a
            href={VIBER}
            className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-semibold hover:bg-muted"
          >
            <MessageCircle className="size-5 text-primary" />
            <span>
              Viber <span className="block text-xs text-muted-foreground">+380933779031</span>
            </span>
          </a>
          <a
            href={PHONE}
            className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-semibold hover:bg-muted"
          >
            <Phone className="size-5 text-primary" />
            <span>
              Телефон <span className="block text-xs text-muted-foreground">+380735251029</span>
            </span>
          </a>
        </div>
      )}
      <button
        type="button"
        onClick={() => setContactOpen(!contactOpen)}
        aria-expanded={contactOpen}
        aria-label={contactOpen ? "Закрити варіанти зв’язку" : "Відкрити варіанти зв’язку"}
        className="fixed bottom-5 right-4 z-50 grid size-12 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 sm:bottom-6 sm:right-6"
      >
        <MessageCircle className="size-5" />
      </button>
    </div>
  );
}
