import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Boxes,
  Building2,
  CarFront,
  ChevronRight,
  ChevronLeft,
  CircleHelp,
  Factory,
  FileClock,
  FileInput,
  FileWarning,
  Gauge,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Pencil,
  Plus,
  Search,
  Save,
  Settings,
  Tags,
  Truck,
  Users,
  X,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { getAdminStatus, logoutAdmin } from "@/lib/admin-auth";
import { getAdminCatalogOverview, listAdminProducts } from "@/lib/catalog";
import {
  listAdminSuppliers,
  listAdminWarehouses,
  listSupplierOptions,
  saveAdminSupplier,
  saveAdminWarehouse,
} from "@/lib/supplier-warehouse";

export const Route = createFileRoute("/admin/")({
  beforeLoad: async () => {
    const status = await getAdminStatus();
    if (!status.authenticated) throw redirect({ to: "/admin/login" });
    if (status.role !== "admin") throw redirect({ to: "/admin/login" });
    return { admin: status };
  },
  component: AdminDashboardPage,
});

const sections = [
  {
    id: "home",
    label: "Главная",
    icon: LayoutDashboard,
    description: "Общая картина работы магазина.",
  },
  {
    id: "products",
    label: "Товары",
    icon: Package,
    description: "Список товаров и основные сведения о них.",
  },
  { id: "brands", label: "Бренды", icon: Tags, description: "Марки производителей автозапчастей." },
  {
    id: "articles",
    label: "Артикулы",
    icon: Boxes,
    description: "Артикулы и связанные с ними товары.",
  },
  {
    id: "crosses",
    label: "Кроссы / аналоги",
    icon: Boxes,
    description: "Совместимые артикулы и аналоги деталей.",
  },
  {
    id: "cars",
    label: "Автомобили",
    icon: CarFront,
    description: "Марки, модели и данные автомобилей.",
  },
  {
    id: "categories",
    label: "Категории",
    icon: Factory,
    description: "Каталог категорий товаров.",
  },
  {
    id: "warehouses",
    label: "Склады",
    icon: Building2,
    description: "Остатки товаров по местам хранения.",
  },
  {
    id: "suppliers",
    label: "Поставщики",
    icon: Truck,
    description: "Контакты и прайс-листы поставщиков.",
  },
  {
    id: "import",
    label: "Импорт",
    icon: FileInput,
    description: "Загрузка товарных данных из файла.",
  },
  {
    id: "prices",
    label: "Обновление прайсов",
    icon: Gauge,
    description: "Обновление цен и остатков товаров.",
  },
  {
    id: "import-history",
    label: "История импортов",
    icon: FileClock,
    description: "Результаты предыдущих загрузок.",
  },
  {
    id: "import-errors",
    label: "Ошибки импорта",
    icon: FileWarning,
    description: "Строки файлов, которые не удалось обработать.",
  },
  {
    id: "search",
    label: "Поиск",
    icon: Search,
    description: "Поиск товаров, артикулов и брендов.",
  },
  {
    id: "settings",
    label: "Настройки",
    icon: Settings,
    description: "Основные настройки магазина и панели.",
  },
  {
    id: "users",
    label: "Пользователи",
    icon: Users,
    description: "Учетные записи и права доступа.",
  },
] as const;

const stats = [
  { label: "Товаров", key: "products", icon: Package },
  { label: "Артикулов", key: "articles", icon: Boxes },
  { label: "Брендов", key: "brands", icon: Tags },
  { label: "Кроссов", key: "crosses", icon: Gauge },
  { label: "Складов", key: "warehouses", icon: Building2 },
  { label: "Поставщиков", key: "suppliers", icon: Truck },
] as const;

type CatalogOverview = {
  configured: boolean;
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
};

function AdminDashboardPage() {
  const { admin } = Route.useRouteContext();
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState<(typeof sections)[number]["id"]>("home");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  const [overview, setOverview] = useState<CatalogOverview | null>(null);
  const selected = sections.find((section) => section.id === activeSection) ?? sections[0];

  useEffect(() => {
    void getAdminCatalogOverview()
      .then((result) => setOverview(result as CatalogOverview))
      .catch(() => setOverview(null));
  }, []);

  const logout = async () => {
    setLoggingOut(true);
    try {
      await logoutAdmin();
      await navigate({ to: "/admin/login" });
    } catch {
      setMessage("Не удалось завершить сеанс. Попробуйте ещё раз.");
      setLoggingOut(false);
    }
  };

  const selectSection = (id: (typeof sections)[number]["id"]) => {
    setActiveSection(id);
    setMobileMenuOpen(false);
  };

  return (
    <main className="min-h-screen bg-muted/30 text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-card">
        <div className="mx-auto flex min-h-16 max-w-[1600px] items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen((open) => !open)}
              aria-label={mobileMenuOpen ? "Закрыть меню" : "Открыть меню"}
              aria-expanded={mobileMenuOpen}
              className="inline-flex size-10 items-center justify-center rounded-lg border border-border hover:bg-muted lg:hidden"
            >
              {mobileMenuOpen ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
            <a href="/" className="text-lg font-black tracking-tight text-primary">
              AJEX
            </a>
            <span className="hidden h-6 border-l border-border sm:block" />
            <span className="hidden text-sm font-semibold text-muted-foreground sm:block">
              Админ-панель
            </span>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <a
              href="/"
              className="hidden items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground sm:inline-flex"
            >
              <ArrowLeft className="size-4" /> На сайт
            </a>
            <div className="hidden text-right sm:block">
              <p className="text-sm font-bold">{admin.username}</p>
              <p className="text-xs text-muted-foreground">Администратор</p>
            </div>
            <button
              type="button"
              onClick={logout}
              disabled={loggingOut}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-bold hover:bg-muted disabled:opacity-60"
            >
              <LogOut className="size-4" /> <span className="hidden sm:inline">Выйти</span>
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1600px] lg:grid-cols-[250px_minmax(0,1fr)]">
        {mobileMenuOpen && (
          <button
            type="button"
            aria-label="Закрыть меню"
            onClick={() => setMobileMenuOpen(false)}
            className="fixed inset-16 z-20 bg-foreground/20 lg:hidden"
          />
        )}
        <aside
          className={`${mobileMenuOpen ? "fixed inset-y-16 left-0 z-30 block w-[min(86vw,300px)] shadow-xl" : "hidden"} border-r border-border bg-card lg:sticky lg:top-16 lg:block lg:h-[calc(100vh-4rem)] lg:overflow-y-auto lg:shadow-none`}
        >
          <nav aria-label="Разделы админ-панели" className="grid gap-1 p-3 sm:p-4">
            {sections.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => selectSection(id)}
                aria-current={activeSection === id ? "page" : undefined}
                className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-left text-sm font-semibold transition-colors ${activeSection === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
              >
                <Icon className="size-4 shrink-0" />
                <span>{label}</span>
                {activeSection === id && <ChevronRight className="ml-auto size-4" />}
              </button>
            ))}
            <a
              href="/admin/change-password"
              className="mt-3 flex min-h-11 items-center gap-3 rounded-lg border-t border-border px-3 pt-3 text-sm font-semibold text-muted-foreground hover:text-foreground"
            >
              <KeyRound className="size-4" /> Изменить пароль
            </a>
          </nav>
        </aside>

        <section className="min-w-0 p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-6xl">
            <div className="mb-6">
              <p className="text-sm font-bold text-primary">Управление магазином</p>
              <h1 className="mt-1 text-2xl font-extrabold sm:text-3xl">{selected.label}</h1>
              <p className="mt-2 text-sm text-muted-foreground">{selected.description}</p>
            </div>

            {activeSection === "home" ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {stats.map(({ label, key, icon: Icon }) => (
                    <article
                      key={label}
                      className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-muted-foreground">{label}</p>
                        <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <Icon className="size-4" />
                        </span>
                      </div>
                      <p className="mt-3 text-3xl font-extrabold">
                        {overview?.configured ? Number(overview[key]).toLocaleString("uk-UA") : "—"}
                      </p>
                    </article>
                  ))}
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-3">
                  <StatusCard
                    title="Последний импорт"
                    value={
                      overview?.configured
                        ? formatRun(overview.last_import, overview.last_import_status)
                        : "Нет подключения"
                    }
                  />
                  <StatusCard
                    title="Обновление прайсов"
                    value={
                      overview?.configured
                        ? formatRun(overview.last_price_update, overview.last_price_status)
                        : "Нет подключения"
                    }
                  />
                  <StatusCard
                    title="Ошибки импорта"
                    value={
                      overview?.configured
                        ? Number(overview.import_errors).toLocaleString("uk-UA")
                        : "—"
                    }
                  />
                </div>
                <div className="mt-6 rounded-xl border border-border bg-card p-5 sm:p-6">
                  <h2 className="text-base font-extrabold">Быстрый переход</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Выберите нужный раздел в меню слева.
                  </p>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {sections
                      .filter((section) =>
                        [
                          "products",
                          "import",
                          "prices",
                          "suppliers",
                          "search",
                          "import-errors",
                        ].includes(section.id),
                      )
                      .map(({ id, label, icon: Icon }) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => selectSection(id)}
                          className="flex min-h-12 items-center gap-3 rounded-lg border border-border px-3 text-left text-sm font-bold hover:border-primary hover:bg-muted/40"
                        >
                          <Icon className="size-4 text-primary" /> {label}
                          <ChevronRight className="ml-auto size-4 text-muted-foreground" />
                        </button>
                      ))}
                  </div>
                </div>
              </>
            ) : activeSection === "products" ? (
              <ProductsSection />
            ) : activeSection === "warehouses" ? (
              <WarehouseManager />
            ) : activeSection === "suppliers" ? (
              <SupplierManager />
            ) : (
              <div className="rounded-xl border border-border bg-card p-6 shadow-sm sm:p-10">
                <div className="mx-auto flex max-w-lg flex-col items-center text-center">
                  <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <selected.icon className="size-7" />
                  </span>
                  <h2 className="mt-4 text-xl font-extrabold">
                    Раздел «{selected.label}» готов к наполнению
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Здесь будут отображаться данные раздела и простые действия для управления ими.
                    Источник данных магазина пока не подключён.
                  </p>
                  <button
                    type="button"
                    onClick={() => selectSection("home")}
                    className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-extrabold text-primary-foreground hover:bg-primary/90"
                  >
                    <LayoutDashboard className="size-4" /> Вернуться на главную
                  </button>
                </div>
              </div>
            )}
            {message && (
              <p role="alert" className="mt-4 text-sm text-destructive">
                {message}
              </p>
            )}
            <p className="mt-6 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
              <CircleHelp className="mt-0.5 size-4 shrink-0" />
              {overview?.configured
                ? "Количество записей каталога приблизительное и обновляется по статистике PostgreSQL."
                : "Подключите PostgreSQL, чтобы показывать статистику и управлять каталогом."}
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

type CatalogItem = {
  id: string;
  brand_name: string;
  article: string;
  name: string;
  category_name: string | null;
  price: string;
  stock: string;
  warehouse_name: string | null;
  supplier_name: string | null;
  status: string;
};

function ProductsSection() {
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<"article" | "price-asc" | "price-desc" | "updated">("article");
  const [cursor, setCursor] = useState<string | undefined>();
  const [history, setHistory] = useState<(string | undefined)[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessage("");
    void listAdminProducts({
      data: {
        search: submittedSearch || undefined,
        status: status ? (status as "active" | "draft" | "archived") : undefined,
        sort,
        cursor,
        limit: 25,
      },
    })
      .then((result) => {
        if (cancelled) return;
        setConfigured(result.configured);
        setItems(result.items as CatalogItem[]);
        setHasMore(result.hasMore);
        setNextCursor(result.nextCursor);
        setMessage(result.message ?? "");
      })
      .catch(() => {
        if (!cancelled) setMessage("Не удалось загрузить товары. Повторите попытку.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cursor, refreshKey, sort, status, submittedSearch]);

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmittedSearch(search.trim());
    setHistory([]);
    setCursor(undefined);
    setRefreshKey((key) => key + 1);
  };

  const nextPage = () => {
    if (!nextCursor) return;
    setHistory((previous) => [...previous, cursor]);
    setCursor(nextCursor);
  };

  const previousPage = () => {
    if (history.length === 0) return;
    setCursor(history[history.length - 1]);
    setHistory((previous) => previous.slice(0, -1));
  };

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      <form
        onSubmit={applyFilters}
        className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-end sm:p-5"
      >
        <label className="grid flex-1 gap-1.5 text-sm font-semibold">
          Поиск по названию или артикулу
          <span className="relative">
            <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Например, AB-1234 или фильтр"
              className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm"
            />
          </span>
        </label>
        <label className="grid gap-1.5 text-sm font-semibold sm:w-44">
          Статус
          <select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setCursor(undefined);
              setHistory([]);
            }}
            className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
          >
            <option value="">Все статусы</option>
            <option value="active">Активные</option>
            <option value="draft">Черновики</option>
            <option value="archived">Архив</option>
          </select>
        </label>
        <label className="grid gap-1.5 text-sm font-semibold sm:w-48">
          Сортировка
          <select
            value={sort}
            onChange={(event) => {
              setSort(event.target.value as typeof sort);
              setCursor(undefined);
              setHistory([]);
            }}
            className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
          >
            <option value="article">По артикулу</option>
            <option value="price-asc">Сначала дешевле</option>
            <option value="price-desc">Сначала дороже</option>
            <option value="updated">Недавно обновлённые</option>
          </select>
        </label>
        <button
          type="submit"
          className="h-10 rounded-lg bg-primary px-4 text-sm font-extrabold text-primary-foreground hover:bg-primary/90"
        >
          Найти
        </button>
      </form>

      {configured === false ? (
        <div className="p-6 text-sm text-muted-foreground">{message}</div>
      ) : loading ? (
        <div className="p-6 text-sm text-muted-foreground" role="status">
          Загружаем страницу товаров…
        </div>
      ) : message ? (
        <div className="p-6 text-sm text-destructive" role="alert">
          {message}
        </div>
      ) : items.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted-foreground">Товары не найдены.</div>
      ) : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-5 py-3">Товар</th>
                  <th className="px-5 py-3">Артикул / бренд</th>
                  <th className="px-5 py-3">Цена</th>
                  <th className="px-5 py-3">Остаток</th>
                  <th className="px-5 py-3">Статус</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-muted/20">
                    <td className="px-5 py-3">
                      <p className="font-bold">{item.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.category_name ?? "Без категории"}
                      </p>
                    </td>
                    <td className="px-5 py-3">
                      <p className="font-bold">{item.article}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{item.brand_name}</p>
                    </td>
                    <td className="px-5 py-3">{Number(item.price).toLocaleString("uk-UA")} ₴</td>
                    <td className="px-5 py-3">{item.stock}</td>
                    <td className="px-5 py-3">
                      {item.status === "active"
                        ? "Активный"
                        : item.status === "draft"
                          ? "Черновик"
                          : "Архив"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="divide-y divide-border md:hidden">
            {items.map((item) => (
              <article key={item.id} className="p-4">
                <p className="font-bold">{item.name}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {item.brand_name} · {item.article}
                </p>
                <p className="mt-2 text-sm">
                  {Number(item.price).toLocaleString("uk-UA")} ₴ · Остаток: {item.stock}
                </p>
              </article>
            ))}
          </div>
        </>
      )}

      {message && configured !== false && (
        <p role="alert" className="px-5 pb-3 text-sm text-destructive">
          {message}
        </p>
      )}
      <div className="flex items-center justify-between border-t border-border px-4 py-3 sm:px-5">
        <p className="text-xs text-muted-foreground">Показываем не более 25 товаров за запрос</p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={previousPage}
            disabled={history.length === 0 || loading}
            className="inline-flex h-9 items-center gap-1 rounded-lg border border-border px-3 text-sm font-semibold disabled:opacity-40"
          >
            <ChevronLeft className="size-4" /> Назад
          </button>
          <button
            type="button"
            onClick={nextPage}
            disabled={!hasMore || loading}
            className="inline-flex h-9 items-center gap-1 rounded-lg border border-border px-3 text-sm font-semibold disabled:opacity-40"
          >
            Дальше <ChevronRight className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusCard({ title, value }: { title: string; value: string }) {
  return (
    <article className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
      <p className="text-sm font-semibold text-muted-foreground">{title}</p>
      <p className="mt-2 text-base font-extrabold">{value}</p>
    </article>
  );
}

function formatRun(date: string | null, status: string | null): string {
  if (!date) return "Не запускалось";
  const formattedDate = new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(date));
  const readableStatus: Record<string, string> = {
    queued: "в очереди",
    running: "выполняется",
    completed: "завершён",
    completed_with_errors: "завершён с ошибками",
    failed: "ошибка",
  };
  return `${formattedDate} · ${readableStatus[status ?? ""] ?? status ?? "статус неизвестен"}`;
}

type SupplierRow = {
  id: string;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  warehouse_count: string;
};

type WarehouseRow = {
  id: string;
  name: string;
  supplier_id: string | null;
  supplier_name: string | null;
  source_type: "api" | "email" | "manual_upload";
  contact_email: string | null;
  api_url: string | null;
  price_format: string;
  is_active: boolean;
  import_settings: {
    delimiter?: string;
    encoding?: string;
    firstRowHeaders?: boolean;
    columnMapping?: Record<string, string>;
  };
  has_credentials: boolean;
  last_updated_at: string | Date | null;
  last_import_at: string | Date | null;
  last_import_status: string;
};

type SupplierOption = { id: string; name: string };

function SupplierManager() {
  const [items, setItems] = useState<SupplierRow[]>([]);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [sort, setSort] = useState<"name" | "updated">("name");
  const [cursor, setCursor] = useState<string | undefined>();
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<(string | undefined)[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | undefined>();
  const [name, setName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void listAdminSuppliers({
      data: { search: submittedSearch || undefined, sort, cursor, limit: 25 },
    })
      .then((result) => {
        if (cancelled) return;
        setConfigured(result.configured);
        setItems(result.items as SupplierRow[]);
        setNextCursor(result.nextCursor);
      })
      .catch(() => {
        if (!cancelled) setError("Не удалось загрузить поставщиков.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cursor, refreshKey, sort, submittedSearch]);

  const resetForm = () => {
    setEditingId(undefined);
    setName("");
    setContactName("");
    setEmail("");
    setPhone("");
    setActive(true);
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const result = await saveAdminSupplier({
        data: { id: editingId, name, contactName, email, phone, active },
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      resetForm();
      setCursor(undefined);
      setHistory([]);
      setRefreshKey((key) => key + 1);
    } catch {
      setError("Не удалось сохранить поставщика. Проверьте данные и подключение к базе.");
    } finally {
      setSaving(false);
    }
  };

  const edit = (supplier: SupplierRow) => {
    setEditingId(supplier.id);
    setName(supplier.name);
    setContactName(supplier.contact_name ?? "");
    setEmail(supplier.email ?? "");
    setPhone(supplier.phone ?? "");
    setActive(supplier.status === "active");
  };

  const applySearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmittedSearch(search.trim());
    setCursor(undefined);
    setHistory([]);
    setRefreshKey((key) => key + 1);
  };

  const goNext = () => {
    if (!nextCursor) return;
    setHistory((previous) => [...previous, cursor]);
    setCursor(nextCursor);
  };
  const goPrevious = () => {
    if (!history.length) return;
    setCursor(history[history.length - 1]);
    setHistory((previous) => previous.slice(0, -1));
  };

  return (
    <div className="grid gap-4">
      <form
        onSubmit={save}
        className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="font-extrabold">
              {editingId ? "Изменить поставщика" : "Новый поставщик"}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Один поставщик может обслуживать несколько складов.
            </p>
          </div>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              className="text-sm font-semibold text-muted-foreground hover:text-foreground"
            >
              Отмена
            </button>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <label className="grid gap-1 text-sm font-semibold">
            Название
            <input
              required
              maxLength={200}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Автотехникс"
              className="h-10 rounded-lg border border-input bg-background px-3 font-normal"
            />
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            Контактное лицо
            <input
              value={contactName}
              onChange={(event) => setContactName(event.target.value)}
              className="h-10 rounded-lg border border-input bg-background px-3 font-normal"
            />
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="h-10 rounded-lg border border-input bg-background px-3 font-normal"
            />
          </label>
          <label className="grid gap-1 text-sm font-semibold">
            Телефон
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              className="h-10 rounded-lg border border-input bg-background px-3 font-normal"
            />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <label className="inline-flex items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
              className="size-4 accent-primary"
            />{" "}
            Активный поставщик
          </label>
          <button
            disabled={saving}
            type="submit"
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-extrabold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            <Save className="size-4" /> {saving ? "Сохраняем…" : "Сохранить поставщика"}
          </button>
        </div>
      </form>

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <form
          onSubmit={applySearch}
          className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-end"
        >
          <label className="grid flex-1 gap-1 text-sm font-semibold">
            Найти поставщика
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Название поставщика"
              className="h-10 rounded-lg border border-input bg-background px-3 font-normal"
            />
          </label>
          <label className="grid gap-1 text-sm font-semibold sm:w-48">
            Сортировка
            <select
              value={sort}
              onChange={(event) => {
                setSort(event.target.value as typeof sort);
                setCursor(undefined);
                setHistory([]);
              }}
              className="h-10 rounded-lg border border-input bg-background px-3 font-normal"
            >
              <option value="name">По названию</option>
              <option value="updated">Недавно изменённые</option>
            </select>
          </label>
          <button
            type="submit"
            className="h-10 rounded-lg border border-border px-4 text-sm font-bold hover:bg-muted"
          >
            Найти
          </button>
        </form>
        {configured === false ? (
          <p className="p-5 text-sm text-muted-foreground">
            Подключите PostgreSQL, чтобы управлять поставщиками.
          </p>
        ) : loading ? (
          <p className="p-5 text-sm text-muted-foreground">Загружаем…</p>
        ) : error ? (
          <p role="alert" className="p-5 text-sm text-destructive">
            {error}
          </p>
        ) : items.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">Поставщиков пока нет.</p>
        ) : (
          <div className="divide-y divide-border">
            {items.map((supplier) => (
              <article
                key={supplier.id}
                className="flex flex-col justify-between gap-3 p-4 sm:flex-row sm:items-center"
              >
                <div className="min-w-0">
                  <h3 className="font-extrabold">{supplier.name}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {[supplier.contact_name, supplier.email, supplier.phone]
                      .filter(Boolean)
                      .join(" · ") || "Контакты не указаны"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Складов: {Number(supplier.warehouse_count).toLocaleString("uk-UA")} ·{" "}
                    {supplier.status === "active" ? "Активный" : "Приостановлен"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => edit(supplier)}
                  className="inline-flex h-9 items-center gap-2 self-start rounded-lg border border-border px-3 text-sm font-bold hover:bg-muted sm:self-auto"
                >
                  <Pencil className="size-4" /> Изменить
                </button>
              </article>
            ))}
          </div>
        )}
        <PaginationFooter
          pageSize={25}
          canPrevious={history.length > 0}
          canNext={Boolean(nextCursor)}
          loading={loading}
          onPrevious={goPrevious}
          onNext={goNext}
        />
      </div>
    </div>
  );
}

type WarehouseForm = {
  id?: string;
  name: string;
  supplierId: string;
  sourceType: "api" | "email" | "manual_upload";
  email: string;
  apiUrl: string;
  priceFormat: "auto" | "csv" | "xlsx" | "xls" | "xml" | "json" | "custom";
  isActive: boolean;
  importSettings: {
    delimiter: "auto" | "comma" | "semicolon" | "tab";
    encoding: "utf-8" | "windows-1251";
    firstRowHeaders: boolean;
    columnMapping: { article: string; brand: string; name: string; price: string; stock: string };
  };
  apiKey: string;
  login: string;
  password: string;
  clearCredentials: boolean;
};

function emptyWarehouseForm(): WarehouseForm {
  return {
    name: "",
    supplierId: "",
    sourceType: "manual_upload",
    email: "",
    apiUrl: "",
    priceFormat: "auto",
    isActive: true,
    importSettings: {
      delimiter: "auto",
      encoding: "utf-8",
      firstRowHeaders: true,
      columnMapping: { article: "", brand: "", name: "", price: "", stock: "" },
    },
    apiKey: "",
    login: "",
    password: "",
    clearCredentials: false,
  };
}

function WarehouseManager() {
  const [items, setItems] = useState<WarehouseRow[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [sort, setSort] = useState<"name" | "updated">("name");
  const [cursor, setCursor] = useState<string | undefined>();
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<(string | undefined)[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<WarehouseForm | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void Promise.all([
      listAdminWarehouses({
        data: { search: submittedSearch || undefined, sort, cursor, limit: 25 },
      }),
      listSupplierOptions(),
    ])
      .then(([warehouseResult, supplierResult]) => {
        if (cancelled) return;
        setConfigured(warehouseResult.configured);
        setItems(warehouseResult.items as WarehouseRow[]);
        setNextCursor(warehouseResult.nextCursor);
        if (supplierResult.configured) setSuppliers(supplierResult.items);
      })
      .catch(() => {
        if (!cancelled) setError("Не удалось загрузить склады. Проверьте подключение к базе.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cursor, refreshKey, sort, submittedSearch]);

  const setField = <K extends keyof WarehouseForm>(key: K, value: WarehouseForm[K]) => {
    setForm((current) => (current ? { ...current, [key]: value } : current));
  };
  const startNew = () => setForm(emptyWarehouseForm());
  const edit = (warehouse: WarehouseRow) => {
    const initial = emptyWarehouseForm();
    initial.id = warehouse.id;
    initial.name = warehouse.name;
    initial.supplierId = warehouse.supplier_id ?? "";
    initial.sourceType = warehouse.source_type;
    initial.email = warehouse.contact_email ?? "";
    initial.apiUrl = warehouse.api_url ?? "";
    initial.priceFormat = warehouse.price_format as WarehouseForm["priceFormat"];
    initial.isActive = warehouse.is_active;
    initial.importSettings = {
      delimiter: (warehouse.import_settings.delimiter ??
        "auto") as WarehouseForm["importSettings"]["delimiter"],
      encoding: (warehouse.import_settings.encoding ??
        "utf-8") as WarehouseForm["importSettings"]["encoding"],
      firstRowHeaders: warehouse.import_settings.firstRowHeaders ?? true,
      columnMapping: {
        ...initial.importSettings.columnMapping,
        ...warehouse.import_settings.columnMapping,
      },
    };
    setForm(initial);
  };
  const changeMapping = (
    field: keyof WarehouseForm["importSettings"]["columnMapping"],
    value: string,
  ) => {
    setForm((current) =>
      current
        ? {
            ...current,
            importSettings: {
              ...current.importSettings,
              columnMapping: { ...current.importSettings.columnMapping, [field]: value },
            },
          }
        : current,
    );
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form) return;
    if (!form.supplierId) {
      setError("Сначала создайте поставщика и выберите его для склада.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const formData = form;
      const result = await saveAdminWarehouse({ data: formData });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setForm(null);
      setCursor(undefined);
      setHistory([]);
      setRefreshKey((key) => key + 1);
    } catch {
      setError("Не удалось сохранить склад. Проверьте настройки и соединение.");
    } finally {
      setSaving(false);
    }
  };
  const applySearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmittedSearch(search.trim());
    setCursor(undefined);
    setHistory([]);
    setRefreshKey((key) => key + 1);
  };
  const goNext = () => {
    if (!nextCursor) return;
    setHistory((previous) => [...previous, cursor]);
    setCursor(nextCursor);
  };
  const goPrevious = () => {
    if (!history.length) return;
    setCursor(history[history.length - 1]);
    setHistory((previous) => previous.slice(0, -1));
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Каждый склад — отдельный источник с собственными доступами и правилами прайса.
        </p>
        <button
          type="button"
          onClick={startNew}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-extrabold text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="size-4" /> Добавить склад
        </button>
      </div>

      {form && (
        <form
          onSubmit={save}
          className="grid gap-5 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-6"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-extrabold">
                {form.id ? "Настройки склада" : "Новый склад / источник"}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Параметры хранятся отдельно для каждого склада.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setForm(null)}
              className="rounded-lg border border-border px-3 py-2 text-sm font-semibold hover:bg-muted"
            >
              Закрыть
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <label className="grid gap-1 text-sm font-semibold">
              Название склада
              <input
                required
                maxLength={200}
                value={form.name}
                onChange={(event) => setField("name", event.target.value)}
                placeholder="Автотехникс Троещина"
                className="h-10 rounded-lg border border-input bg-background px-3 font-normal"
              />
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              Поставщик
              <select
                required
                value={form.supplierId}
                onChange={(event) => setField("supplierId", event.target.value)}
                className="h-10 rounded-lg border border-input bg-background px-3 font-normal"
              >
                <option value="">Выберите поставщика</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              Тип источника
              <select
                value={form.sourceType}
                onChange={(event) =>
                  setField("sourceType", event.target.value as WarehouseForm["sourceType"])
                }
                className="h-10 rounded-lg border border-input bg-background px-3 font-normal"
              >
                <option value="api">API</option>
                <option value="email">Email</option>
                <option value="manual_upload">Ручная загрузка файла</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              Email
              <input
                type="email"
                value={form.email}
                onChange={(event) => setField("email", event.target.value)}
                placeholder="Почта склада или прайс-листа"
                className="h-10 rounded-lg border border-input bg-background px-3 font-normal"
              />
            </label>
            {form.sourceType === "api" && (
              <label className="grid gap-1 text-sm font-semibold sm:col-span-2">
                API URL
                <input
                  type="url"
                  value={form.apiUrl}
                  onChange={(event) => setField("apiUrl", event.target.value)}
                  placeholder="https://supplier.example/api"
                  className="h-10 rounded-lg border border-input bg-background px-3 font-normal"
                />
              </label>
            )}
            <label className="grid gap-1 text-sm font-semibold">
              Формат прайса
              <select
                value={form.priceFormat}
                onChange={(event) =>
                  setField("priceFormat", event.target.value as WarehouseForm["priceFormat"])
                }
                className="h-10 rounded-lg border border-input bg-background px-3 font-normal"
              >
                <option value="auto">Определять автоматически</option>
                <option value="csv">CSV</option>
                <option value="xlsx">Excel (.xlsx)</option>
                <option value="xls">Excel (.xls)</option>
                <option value="xml">XML</option>
                <option value="json">JSON</option>
                <option value="custom">Другой формат</option>
              </select>
            </label>
          </div>

          {(form.sourceType !== "manual_upload" ||
            Boolean(form.id && items.find((item) => item.id === form.id)?.has_credentials)) && (
            <section className="grid gap-3 rounded-lg border border-border bg-muted/20 p-4 sm:grid-cols-3">
              <div className="sm:col-span-3">
                <h3 className="text-sm font-extrabold">Доступ к источнику</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Ключи и пароли будут зашифрованы перед сохранением.{" "}
                  {form.id
                    ? "Оставьте поле пустым, чтобы сохранить текущий доступ."
                    : "Заполните только данные, которые выдал поставщик."}
                </p>
              </div>
              {form.sourceType === "api" && (
                <label className="grid gap-1 text-sm font-semibold sm:col-span-3">
                  API-ключ
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={form.apiKey}
                    onChange={(event) => setField("apiKey", event.target.value)}
                    className="h-10 rounded-lg border border-input bg-background px-3 font-normal"
                  />
                </label>
              )}
              <label className="grid gap-1 text-sm font-semibold">
                Логин
                <input
                  autoComplete="username"
                  value={form.login}
                  onChange={(event) => setField("login", event.target.value)}
                  className="h-10 rounded-lg border border-input bg-background px-3 font-normal"
                />
              </label>
              <label className="grid gap-1 text-sm font-semibold">
                Пароль
                <input
                  type="password"
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(event) => setField("password", event.target.value)}
                  className="h-10 rounded-lg border border-input bg-background px-3 font-normal"
                />
              </label>
              {form.id && items.find((item) => item.id === form.id)?.has_credentials && (
                <label className="flex items-center gap-2 self-end pb-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.clearCredentials}
                    onChange={(event) => setField("clearCredentials", event.target.checked)}
                    className="size-4 accent-primary"
                  />{" "}
                  Удалить сохранённые доступы
                </label>
              )}
            </section>
          )}

          <section className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="sm:col-span-2 xl:col-span-4">
              <h3 className="text-sm font-extrabold">Как читать прайс</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Если формат автоматический, при обработке система попробует определить тип и колонки
                по заголовкам. Укажите названия колонок, если у поставщика нестандартные заголовки.
              </p>
            </div>
            <label className="grid gap-1 text-sm font-semibold">
              Разделитель CSV
              <select
                value={form.importSettings.delimiter}
                onChange={(event) =>
                  setField("importSettings", {
                    ...form.importSettings,
                    delimiter: event.target.value as WarehouseForm["importSettings"]["delimiter"],
                  })
                }
                className="h-10 rounded-lg border border-input bg-background px-3 font-normal"
              >
                <option value="auto">Определить автоматически</option>
                <option value="semicolon">Точка с запятой</option>
                <option value="comma">Запятая</option>
                <option value="tab">Табуляция</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              Кодировка
              <select
                value={form.importSettings.encoding}
                onChange={(event) =>
                  setField("importSettings", {
                    ...form.importSettings,
                    encoding: event.target.value as WarehouseForm["importSettings"]["encoding"],
                  })
                }
                className="h-10 rounded-lg border border-input bg-background px-3 font-normal"
              >
                <option value="utf-8">UTF-8</option>
                <option value="windows-1251">Windows-1251</option>
              </select>
            </label>
            <label className="flex items-center gap-2 self-end pb-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={form.importSettings.firstRowHeaders}
                onChange={(event) =>
                  setField("importSettings", {
                    ...form.importSettings,
                    firstRowHeaders: event.target.checked,
                  })
                }
                className="size-4 accent-primary"
              />{" "}
              Первая строка — заголовки
            </label>
            <div className="grid gap-3 sm:col-span-2 xl:col-span-4 sm:grid-cols-2 xl:grid-cols-5">
              {(["article", "brand", "name", "price", "stock"] as const).map((column) => (
                <label key={column} className="grid gap-1 text-xs font-semibold">
                  {
                    {
                      article: "Колонка артикула",
                      brand: "Колонка бренда",
                      name: "Колонка названия",
                      price: "Колонка цены",
                      stock: "Колонка остатка",
                    }[column]
                  }
                  <input
                    value={form.importSettings.columnMapping[column]}
                    onChange={(event) => changeMapping(column, event.target.value)}
                    placeholder="Авто по заголовку"
                    className="h-9 min-w-0 rounded-lg border border-input bg-background px-2 text-sm font-normal"
                  />
                </label>
              ))}
            </div>
          </section>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) => setField("isActive", event.target.checked)}
                className="size-4 accent-primary"
              />{" "}
              Источник активен
            </label>
            <button
              disabled={saving}
              type="submit"
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-extrabold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              <Save className="size-4" /> {saving ? "Сохраняем…" : "Сохранить склад"}
            </button>
          </div>
        </form>
      )}

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <form
          onSubmit={applySearch}
          className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-end"
        >
          <label className="grid flex-1 gap-1 text-sm font-semibold">
            Найти склад или поставщика
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Например, Автотехникс"
              className="h-10 rounded-lg border border-input bg-background px-3 font-normal"
            />
          </label>
          <label className="grid gap-1 text-sm font-semibold sm:w-48">
            Сортировка
            <select
              value={sort}
              onChange={(event) => {
                setSort(event.target.value as typeof sort);
                setCursor(undefined);
                setHistory([]);
              }}
              className="h-10 rounded-lg border border-input bg-background px-3 font-normal"
            >
              <option value="name">По названию</option>
              <option value="updated">Недавно изменённые</option>
            </select>
          </label>
          <button
            type="submit"
            className="h-10 rounded-lg border border-border px-4 text-sm font-bold hover:bg-muted"
          >
            Найти
          </button>
        </form>
        {configured === false ? (
          <p className="p-5 text-sm text-muted-foreground">
            Подключите PostgreSQL, чтобы управлять складами.
          </p>
        ) : loading ? (
          <p className="p-5 text-sm text-muted-foreground">Загружаем…</p>
        ) : items.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">Складов пока нет.</p>
        ) : (
          <div className="divide-y divide-border">
            {items.map((warehouse) => (
              <article
                key={warehouse.id}
                className="flex flex-col justify-between gap-4 p-4 lg:flex-row lg:items-center"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-extrabold">{warehouse.name}</h3>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-bold ${warehouse.is_active ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}
                    >
                      {warehouse.is_active ? "Активен" : "Приостановлен"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {warehouse.supplier_name ?? "Поставщик не указан"} ·{" "}
                    {sourceTypeLabel(warehouse.source_type)} · {formatLabel(warehouse.price_format)}
                  </p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {warehouse.contact_email || warehouse.api_url || "Источник не настроен"}
                    {warehouse.has_credentials ? " · доступ сохранён" : ""}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Последний импорт:{" "}
                    {warehouse.last_import_at
                      ? `${formatDate(warehouse.last_import_at)} · ${importStatusLabel(warehouse.last_import_status)}`
                      : "не выполнялся"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Данные обновлялись:{" "}
                    {warehouse.last_updated_at
                      ? formatDate(warehouse.last_updated_at)
                      : "ещё не обновлялись"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => edit(warehouse)}
                  className="inline-flex h-9 items-center gap-2 self-start rounded-lg border border-border px-3 text-sm font-bold hover:bg-muted lg:self-center"
                >
                  <Pencil className="size-4" /> Настроить
                </button>
              </article>
            ))}
          </div>
        )}
        <PaginationFooter
          pageSize={25}
          canPrevious={history.length > 0}
          canNext={Boolean(nextCursor)}
          loading={loading}
          onPrevious={goPrevious}
          onNext={goNext}
        />
      </div>
    </div>
  );
}

function PaginationFooter({
  pageSize,
  canPrevious,
  canNext,
  loading,
  onPrevious,
  onNext,
}: {
  pageSize: number;
  canPrevious: boolean;
  canNext: boolean;
  loading: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex items-center justify-between border-t border-border px-4 py-3 sm:px-5">
      <p className="text-xs text-muted-foreground">Не более {pageSize} записей за запрос</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onPrevious}
          disabled={!canPrevious || loading}
          className="inline-flex h-9 items-center gap-1 rounded-lg border border-border px-3 text-sm font-semibold disabled:opacity-40"
        >
          <ChevronLeft className="size-4" /> Назад
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!canNext || loading}
          className="inline-flex h-9 items-center gap-1 rounded-lg border border-border px-3 text-sm font-semibold disabled:opacity-40"
        >
          Дальше <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  );
}

function sourceTypeLabel(type: WarehouseRow["source_type"]): string {
  return type === "api" ? "API" : type === "email" ? "Email" : "Загрузка файла";
}

function formatLabel(format: string): string {
  const labels: Record<string, string> = {
    auto: "Формат: автоопределение",
    csv: "CSV",
    xlsx: "Excel XLSX",
    xls: "Excel XLS",
    xml: "XML",
    json: "JSON",
    custom: "Другой формат",
  };
  return labels[format] ?? format;
}

function formatDate(value: string | Date): string {
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

function importStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    never: "не выполнялся",
    queued: "в очереди",
    running: "выполняется",
    success: "завершён",
    success_with_errors: "завершён с ошибками",
    failed: "ошибка",
  };
  return labels[status] ?? status;
}
