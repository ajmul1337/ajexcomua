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
  FileSpreadsheet,
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
  SlidersHorizontal,
  Settings,
  Tags,
  Truck,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { getAdminStatus, logoutAdmin } from "@/lib/admin-auth";
import { getAdminCatalogOverview, listAdminProducts } from "@/lib/catalog";
import { listAdminProductOffers } from "@/lib/product-offers";
import {
  addAdminProductCross,
  bulkAdminProducts,
  deleteAdminProductCross,
  getAdminProduct,
  setAdminProductOem,
  updateAdminProduct,
} from "@/lib/admin-products";
import {
  deleteAdminCross,
  listAdminCrosses,
  listAlternativesByEndpoint,
  saveAdminCross,
  updateAdminCross,
} from "@/lib/crosses";
import {
  listAdminSuppliers,
  listAdminWarehouses,
  listSupplierOptions,
  saveAdminSupplier,
  saveAdminWarehouse,
  saveWarehouseImportSettings,
} from "@/lib/supplier-warehouse";

async function triggerSourceUpdate(warehouseId: string): Promise<void> {
  const response = await fetch(
    `/api/admin/source-updates?warehouseId=${encodeURIComponent(warehouseId)}`,
    { method: "POST" },
  );
  const body = (await response.json()) as { ok?: boolean; error?: string };
  if (!response.ok || !body.ok)
    throw new Error(body.error || "Не удалось поставить обновление в очередь");
}

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
    id: "warehouse-import",
    label: "Настройка импорта склада",
    icon: SlidersHorizontal,
    description:
      "Сохраните соответствие колонок отдельно для каждого склада и проверьте файл перед импортом.",
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
            ) : activeSection === "crosses" ? (
              <CrossesSection />
            ) : activeSection === "warehouses" ? (
              <WarehouseManager />
            ) : activeSection === "suppliers" ? (
              <SupplierManager />
            ) : activeSection === "warehouse-import" || activeSection === "import" ? (
              <WarehouseImportSettings />
            ) : activeSection === "import-history" ? (
              <ImportHistorySection />
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
type AdminProductDetail = {
  product: {
    id: string;
    name: string;
    description: string | null;
    price: string;
    stock: string;
    status: string;
    brand: string;
    category_id: string | null;
  };
  crosses: Array<{ id: string; brand: string; article: string; product_id: string | null }>;
  oems: Array<{ id: string; brand: string; article: string }>;
  offers: Array<{
    warehouse: string;
    supplier: string | null;
    price: string;
    stock: string;
    status: string;
    updated_at: string | Date;
  }>;
  history: Array<{ id: string; action: string; payload: unknown; created_at: string | Date }>;
};

function CrossesSection() {
  const [items, setItems] = useState<
    Array<{
      id: string;
      linked_id: string;
      brand: string;
      article: string;
      linked_brand: string;
      linked_article: string;
      source: string;
    }>
  >([]);
  const [search, setSearch] = useState("");
  const [leftBrand, setLeftBrand] = useState("");
  const [leftArticle, setLeftArticle] = useState("");
  const [rightBrand, setRightBrand] = useState("");
  const [rightArticle, setRightArticle] = useState("");
  const [editing, setEditing] = useState<{ id: string; linked_id: string } | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [lastRunId, setLastRunId] = useState<string | null>(null);
  const [alternativeItems, setAlternativeItems] = useState<
    Array<{ brand: string; article: string; name: string | null }>
  >([]);
  const [alternativeTitle, setAlternativeTitle] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const load = useCallback(
    async (cursor?: string) => {
      setLoading(true);
      try {
        const result = await listAdminCrosses({
          data: { search: search || undefined, cursor, limit: 50 },
        });
        setItems((previous) =>
          cursor
            ? [...previous, ...(result.items as typeof items)]
            : (result.items as typeof items),
        );
        setNextCursor(result.nextCursor ?? null);
      } catch {
        setMessage("Не удалось загрузить кроссы.");
      } finally {
        setLoading(false);
      }
    },
    [search],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage("");
    const data = {
      left: { brand: leftBrand, article: leftArticle },
      right: { brand: rightBrand, article: rightArticle },
    };
    const result = editing
      ? await updateAdminCross({
          data: { ...data, oldLeftId: editing.id, oldRightId: editing.linked_id },
        })
      : await saveAdminCross({ data });
    if (!result.ok) {
      setMessage("Не удалось удалить аналог.");
      return;
    }
    setLeftBrand("");
    setLeftArticle("");
    setRightBrand("");
    setRightArticle("");
    setEditing(null);
    setMessage(result.result === "duplicate" ? "Такой кросс уже существует." : "Кросс сохранён.");
    await load();
  };
  const upload = async () => {
    if (!file) return;
    const response = await fetch("/api/admin/crosses/import", {
      method: "POST",
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "x-file-name": file.name,
      },
      body: file.stream(),
      duplex: "half",
    } as RequestInit);
    const result = (await response.json()) as {
      ok?: boolean;
      runId?: string;
      rowsTotal?: number;
      created?: number;
      duplicate?: number;
      errors?: number;
      error?: string;
    };
    setMessage(
      result.ok
        ? `Импорт: строк ${result.rowsTotal}, создано ${result.created}, дубликатов ${result.duplicate}, ошибок ${result.errors}`
        : (result.error ?? "Ошибка импорта"),
    );
    setLastRunId(result.runId ?? null);
    await load();
  };
  const showAlternatives = async (brand: string, article: string) => {
    try {
      const result = await listAlternativesByEndpoint({ data: { brand, article } });
      setAlternativeItems(result.items as typeof alternativeItems);
      setAlternativeTitle(`${brand} ${article}`);
    } catch {
      setMessage("Не удалось загрузить аналоги.");
    }
  };
  return (
    <div className="grid gap-4">
      <form
        onSubmit={save}
        className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-4"
      >
        <input
          required
          placeholder="Бренд"
          value={leftBrand}
          onChange={(e) => setLeftBrand(e.target.value)}
          className="h-10 rounded-lg border border-input px-3"
        />
        <input
          required
          placeholder="Артикул"
          value={leftArticle}
          onChange={(e) => setLeftArticle(e.target.value)}
          className="h-10 rounded-lg border border-input px-3"
        />
        <input
          required
          placeholder="Аналог-бренд"
          value={rightBrand}
          onChange={(e) => setRightBrand(e.target.value)}
          className="h-10 rounded-lg border border-input px-3"
        />
        <input
          required
          placeholder="Аналог-артикул"
          value={rightArticle}
          onChange={(e) => setRightArticle(e.target.value)}
          className="h-10 rounded-lg border border-input px-3"
        />
        <button className="h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground sm:col-span-4">
          {editing ? "Сохранить изменения" : "Добавить кросс"}
        </button>
      </form>
      <div className="flex flex-wrap gap-3 rounded-xl border border-border bg-card p-4">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <button
          type="button"
          disabled={!file || loading}
          onClick={() => void upload()}
          className="rounded-lg border border-border px-4 py-2 text-sm font-bold"
        >
          Импорт CSV
        </button>
        {lastRunId && (
          <a
            href={`/api/admin/crosses/errors?runId=${encodeURIComponent(lastRunId)}`}
            download
            className="rounded-lg border border-border px-4 py-2 text-sm font-bold"
          >
            Скачать ошибки
          </a>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void load();
          }}
          className="ml-auto flex gap-2"
        >
          <input
            placeholder="Поиск бренда или артикула"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 rounded-lg border border-input px-3"
          />
          <button className="rounded-lg border border-border px-4 text-sm font-bold">Найти</button>
        </form>
      </div>
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="p-3">Бренд</th>
              <th className="p-3">Артикул</th>
              <th className="p-3">Аналог</th>
              <th className="p-3">Источник</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((item) => (
              <tr key={`${item.id}-${item.linked_id}`}>
                <td className="p-3">{item.brand}</td>
                <td className="p-3">{item.article}</td>
                <td className="p-3">
                  {item.linked_brand} {item.linked_article}
                </td>
                <td className="p-3">{item.source}</td>
                <td className="p-3">
                  <button
                    type="button"
                    onClick={() => {
                      setEditing({ id: item.id, linked_id: item.linked_id });
                      setLeftBrand(item.brand);
                      setLeftArticle(item.article);
                      setRightBrand(item.linked_brand);
                      setRightArticle(item.linked_article);
                    }}
                    className="mr-3 text-primary"
                  >
                    Изменить
                  </button>
                  <button
                    type="button"
                    onClick={() => void showAlternatives(item.brand, item.article)}
                    className="mr-3 text-primary"
                  >
                    Аналоги
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!window.confirm("Удалить этот кросс?")) return;
                      void deleteAdminCross({
                        data: { leftId: item.id, rightId: item.linked_id, confirmed: true },
                      }).then(() => load());
                    }}
                    className="text-destructive"
                  >
                    Удалить
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!items.length && <p className="p-5 text-sm text-muted-foreground">Кроссов пока нет.</p>}
      </div>
      {nextCursor && (
        <button
          type="button"
          onClick={() => void load(nextCursor)}
          className="rounded-lg border border-border px-4 py-2 text-sm font-bold"
        >
          Загрузить ещё
        </button>
      )}
      {alternativeTitle && (
        <section className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold">Аналоги: {alternativeTitle}</h3>
            <button
              type="button"
              className="text-sm text-muted-foreground"
              onClick={() => setAlternativeTitle("")}
            >
              Закрыть
            </button>
          </div>
          {alternativeItems.length ? (
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {alternativeItems.map((alternative) => (
                <li
                  key={`${alternative.brand}-${alternative.article}`}
                  className="rounded-lg bg-muted px-3 py-2 text-sm"
                >
                  <strong>
                    {alternative.brand} {alternative.article}
                  </strong>
                  {alternative.name ? ` — ${alternative.name}` : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">Аналогов пока нет.</p>
          )}
        </section>
      )}
    </div>
  );
}

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
  const [alternativeItems, setAlternativeItems] = useState<
    Array<{ brand: string; article: string; name: string | null }>
  >([]);
  const [alternativeTitle, setAlternativeTitle] = useState("");
  const [offerItems, setOfferItems] = useState<
    Array<{
      warehouse: string;
      supplier: string | null;
      price: string;
      stock: string;
      lead_time_days: number | null;
      supplier_article: string | null;
      status: string;
      updated_at: string | Date;
    }>
  >([]);
  const [offerTitle, setOfferTitle] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [detail, setDetail] = useState<AdminProductDetail | null>(null);
  const [editForm, setEditForm] = useState({
    name: "",
    description: "",
    price: "",
    stock: "",
    brand: "",
    categoryId: "",
    status: "active",
  });
  const [crossForm, setCrossForm] = useState({ brand: "", article: "" });
  const [oemForm, setOemForm] = useState({ brand: "", articles: "" });
  const [bulkStatus, setBulkStatus] = useState("active");
  const [bulkCategory, setBulkCategory] = useState("");

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
  const showProductAlternatives = async (brand: string, article: string) => {
    try {
      const result = await listAlternativesByEndpoint({ data: { brand, article } });
      setAlternativeItems(result.items as typeof alternativeItems);
      setAlternativeTitle(`${brand} ${article}`);
    } catch {
      setMessage("Не удалось загрузить аналоги.");
    }
  };
  const showProductOffers = async (brand: string, article: string) => {
    try {
      const result = await listAdminProductOffers({ data: { brand, article } });
      setOfferItems(result.items as typeof offerItems);
      setOfferTitle(`${brand} ${article}`);
    } catch {
      setMessage("Не удалось загрузить предложения.");
    }
  };
  const openProduct = async (id: string) => {
    try {
      const result = await getAdminProduct({ data: { id } });
      const loaded = result as unknown as AdminProductDetail;
      setDetail(loaded);
      if (loaded.product)
        setEditForm({
          name: loaded.product.name,
          description: loaded.product.description ?? "",
          price: loaded.product.price,
          stock: loaded.product.stock,
          brand: loaded.product.brand,
          categoryId: loaded.product.category_id ?? "",
          status: loaded.product.status,
        });
      const firstOem = loaded.oems?.[0];
      setOemForm({
        brand: firstOem?.brand ?? loaded.product.brand,
        articles: loaded.oems?.map((item) => item.article).join("; ") ?? "",
      });
    } catch {
      setMessage("Не удалось открыть товар.");
    }
  };
  const saveProduct = async () => {
    if (!detail) return;
    const result = await updateAdminProduct({
      data: {
        id: detail.product.id,
        name: editForm.name,
        description: editForm.description || null,
        price: Number(editForm.price),
        stock: Number(editForm.stock),
        brand: editForm.brand,
        categoryId: editForm.categoryId || null,
        status: editForm.status as "active" | "draft" | "archived",
      },
    });
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setMessage("Товар обновлён.");
    setRefreshKey((key) => key + 1);
    await openProduct(detail.product.id);
  };
  const bulkAction = async (action: "status" | "category" | "delete" | "refresh") => {
    if (!selectedIds.length) return;
    if (
      (action === "delete" || action === "refresh") &&
      !window.confirm(
        action === "delete"
          ? "Удалить выбранные товары? Это действие нельзя отменить."
          : "Обновить выбранные товары?",
      )
    )
      return;
    const result = await bulkAdminProducts({
      data: {
        ids: selectedIds,
        action,
        status: bulkStatus as "active" | "draft" | "archived",
        categoryId: bulkCategory || null,
        confirmed: action === "delete",
      },
    });
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setMessage(`Обработано товаров: ${result.affected}`);
    setSelectedIds([]);
    setRefreshKey((key) => key + 1);
  };
  const addCross = async () => {
    if (!detail || !crossForm.brand.trim() || !crossForm.article.trim()) return;
    const result = await addAdminProductCross({
      data: { productId: detail.product.id, endpoint: crossForm },
    });
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setCrossForm({ brand: "", article: "" });
    await openProduct(detail.product.id);
  };
  const saveOem = async () => {
    if (!detail || !oemForm.brand.trim()) return;
    const result = await setAdminProductOem({
      data: {
        productId: detail.product.id,
        brand: oemForm.brand,
        articles: oemForm.articles
          .split(/[,;\n]/)
          .map((value) => value.trim())
          .filter(Boolean),
      },
    });
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    await openProduct(detail.product.id);
  };
  const deleteCross = async (crossNumberId: string) => {
    if (!detail || !window.confirm("Удалить связь с этим аналогом?")) return;
    const result = await deleteAdminProductCross({
      data: { productId: detail.product.id, crossNumberId, confirmed: true },
    });
    if (!result.ok) {
      setMessage("Не удалось удалить аналог.");
      return;
    }
    await openProduct(detail.product.id);
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

      {selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/30 p-4 text-sm">
          <strong>Выбрано: {selectedIds.length}</strong>
          <select
            value={bulkStatus}
            onChange={(event) => setBulkStatus(event.target.value)}
            className="h-9 rounded border border-input bg-background px-2"
          >
            <option value="active">Активный</option>
            <option value="draft">Черновик</option>
            <option value="archived">Архив</option>
          </select>
          <button
            type="button"
            className="rounded bg-primary px-3 py-2 font-semibold text-primary-foreground"
            onClick={() => void bulkAction("status")}
          >
            Изменить статус
          </button>
          <input
            value={bulkCategory}
            onChange={(event) => setBulkCategory(event.target.value)}
            placeholder="ID категории"
            className="h-9 w-28 rounded border border-input bg-background px-2"
          />
          <button
            type="button"
            className="rounded border border-border px-3 py-2 font-semibold"
            onClick={() => void bulkAction("category")}
          >
            Изменить категорию
          </button>
          <button
            type="button"
            className="rounded border border-destructive px-3 py-2 font-semibold text-destructive"
            onClick={() => void bulkAction("delete")}
          >
            Удалить
          </button>
        </div>
      )}
      {detail && (
        <section className="border-b border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-extrabold">
              Товар: {detail.product.brand} · {detail.product.name}
            </h3>
            <button
              type="button"
              className="text-sm text-muted-foreground"
              onClick={() => setDetail(null)}
            >
              Закрыть
            </button>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="grid gap-1 text-sm">
              Бренд
              <input
                value={editForm.brand}
                onChange={(event) => setEditForm({ ...editForm, brand: event.target.value })}
                className="h-9 rounded border border-input px-2"
              />
            </label>
            <label className="grid gap-1 text-sm">
              Название
              <input
                value={editForm.name}
                onChange={(event) => setEditForm({ ...editForm, name: event.target.value })}
                className="h-9 rounded border border-input px-2"
              />
            </label>
            <label className="grid gap-1 text-sm">
              Цена
              <input
                type="number"
                value={editForm.price}
                onChange={(event) => setEditForm({ ...editForm, price: event.target.value })}
                className="h-9 rounded border border-input px-2"
              />
            </label>
            <label className="grid gap-1 text-sm">
              Наличие
              <input
                type="number"
                value={editForm.stock}
                onChange={(event) => setEditForm({ ...editForm, stock: event.target.value })}
                className="h-9 rounded border border-input px-2"
              />
            </label>
            <label className="grid gap-1 text-sm sm:col-span-2">
              Описание
              <textarea
                value={editForm.description}
                onChange={(event) => setEditForm({ ...editForm, description: event.target.value })}
                className="min-h-20 rounded border border-input px-2 py-1"
              />
            </label>
            <label className="grid gap-1 text-sm">
              Категория ID
              <input
                value={editForm.categoryId}
                onChange={(event) => setEditForm({ ...editForm, categoryId: event.target.value })}
                className="h-9 rounded border border-input px-2"
              />
            </label>
            <label className="grid gap-1 text-sm">
              Статус
              <select
                value={editForm.status}
                onChange={(event) => setEditForm({ ...editForm, status: event.target.value })}
                className="h-9 rounded border border-input px-2"
              >
                <option value="active">Активный</option>
                <option value="draft">Черновик</option>
                <option value="archived">Архив</option>
              </select>
            </label>
          </div>
          <button
            type="button"
            className="mt-3 rounded bg-primary px-4 py-2 font-bold text-primary-foreground"
            onClick={() => void saveProduct()}
          >
            Сохранить изменения
          </button>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              value={oemForm.brand}
              onChange={(event) => setOemForm({ ...oemForm, brand: event.target.value })}
              placeholder="OEM бренд"
              className="h-9 rounded border border-input px-2"
            />
            <input
              value={oemForm.articles}
              onChange={(event) => setOemForm({ ...oemForm, articles: event.target.value })}
              placeholder="OEM артикулы через ;"
              className="h-9 min-w-60 rounded border border-input px-2"
            />
            <button
              type="button"
              className="rounded border border-border px-3 py-2 font-semibold"
              onClick={() => void saveOem()}
            >
              Сохранить OEM
            </button>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <h4 className="font-bold">OEM</h4>
              <p className="text-sm text-muted-foreground">
                {detail.oems.map((item) => `${item.brand} ${item.article}`).join(", ") ||
                  "Не указан"}
              </p>
            </div>
            <div className="sm:col-span-2">
              <h4 className="font-bold">Аналоги</h4>
              <div className="mt-2 flex flex-wrap gap-2">
                <input
                  value={crossForm.brand}
                  onChange={(event) => setCrossForm({ ...crossForm, brand: event.target.value })}
                  placeholder="Бренд аналога"
                  className="h-9 rounded border border-input px-2"
                />
                <input
                  value={crossForm.article}
                  onChange={(event) => setCrossForm({ ...crossForm, article: event.target.value })}
                  placeholder="Артикул аналога"
                  className="h-9 rounded border border-input px-2"
                />
                <button
                  type="button"
                  className="rounded border border-border px-3 py-2 font-semibold"
                  onClick={() => void addCross()}
                >
                  Добавить аналог
                </button>
              </div>
              {detail.crosses.map((cross) => (
                <p key={cross.id} className="flex items-center gap-2 text-sm text-muted-foreground">
                  {cross.brand} {cross.article}
                  <button
                    type="button"
                    className="text-destructive"
                    onClick={() => void deleteCross(cross.id)}
                  >
                    Удалить
                  </button>
                </p>
              ))}
            </div>
            <div>
              <h4 className="font-bold">Склады</h4>
              {detail.offers.map((offer) => (
                <p
                  key={`${offer.warehouse}-${offer.updated_at}`}
                  className="text-sm text-muted-foreground"
                >
                  {offer.warehouse} · {offer.supplier ?? "—"} · {offer.price} · {offer.stock} шт.
                </p>
              ))}
            </div>
            <div>
              <h4 className="font-bold">История обновлений</h4>
              {detail.history.map((entry) => (
                <p key={entry.id} className="text-sm text-muted-foreground">
                  {new Date(entry.created_at).toLocaleString("ru-RU")} · {entry.action}
                </p>
              ))}
            </div>
          </div>
        </section>
      )}
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
                  <th className="px-5 py-3">
                    <input
                      type="checkbox"
                      aria-label="Выбрать все на странице"
                      checked={
                        items.length > 0 && items.every((item) => selectedIds.includes(item.id))
                      }
                      onChange={(event) =>
                        setSelectedIds(event.target.checked ? items.map((item) => item.id) : [])
                      }
                    />
                  </th>
                  <th className="px-5 py-3">Товар</th>
                  <th className="px-5 py-3">Артикул / бренд</th>
                  <th className="px-5 py-3">Цена</th>
                  <th className="px-5 py-3">Остаток</th>
                  <th className="px-5 py-3">Статус</th>
                  <th className="px-5 py-3">Аналоги</th>
                  <th className="px-5 py-3">Предложения</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-muted/20">
                    <td className="px-5 py-3">
                      <input
                        type="checkbox"
                        aria-label={`Выбрать ${item.article}`}
                        checked={selectedIds.includes(item.id)}
                        onChange={(event) =>
                          setSelectedIds((ids) =>
                            event.target.checked
                              ? [...new Set([...ids, item.id])]
                              : ids.filter((id) => id !== item.id),
                          )
                        }
                      />
                    </td>
                    <td className="px-5 py-3">
                      <p className="font-bold">{item.name}</p>
                      <button
                        type="button"
                        className="mt-1 text-xs font-semibold text-primary hover:underline"
                        onClick={() => void openProduct(item.id)}
                      >
                        Открыть и изменить
                      </button>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.category_name ?? "Без категории"}
                      </p>
                    </td>
                    <td className="px-5 py-3">
                      <button
                        type="button"
                        className="text-primary hover:underline"
                        onClick={() => void showProductOffers(item.brand_name, item.article)}
                      >
                        Склады
                      </button>
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
                    <td className="px-5 py-3">
                      <button
                        type="button"
                        className="text-primary hover:underline"
                        onClick={() => void showProductAlternatives(item.brand_name, item.article)}
                      >
                        Аналоги
                      </button>
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
                <button
                  type="button"
                  className="mt-1 text-xs font-semibold text-primary"
                  onClick={() => void openProduct(item.id)}
                >
                  Открыть и изменить
                </button>
                <p className="mt-1 text-sm text-muted-foreground">
                  {item.brand_name} · {item.article}
                </p>
                <p className="mt-2 text-sm">
                  {Number(item.price).toLocaleString("uk-UA")} ₴ · Остаток: {item.stock}
                </p>
                <button
                  type="button"
                  className="mt-2 text-sm font-semibold text-primary"
                  onClick={() => void showProductAlternatives(item.brand_name, item.article)}
                >
                  Аналоги
                </button>
                <button
                  type="button"
                  className="ml-3 mt-2 text-sm font-semibold text-primary"
                  onClick={() => void showProductOffers(item.brand_name, item.article)}
                >
                  Склады
                </button>
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
      {alternativeTitle && (
        <section className="border-t border-border p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-bold">Аналоги: {alternativeTitle}</h3>
            <button
              type="button"
              className="text-sm text-muted-foreground"
              onClick={() => setAlternativeTitle("")}
            >
              Закрыть
            </button>
          </div>
          {alternativeItems.length ? (
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {alternativeItems.map((alternative) => (
                <li
                  key={`${alternative.brand}-${alternative.article}`}
                  className="rounded-lg bg-muted px-3 py-2 text-sm"
                >
                  <strong>
                    {alternative.brand} {alternative.article}
                  </strong>
                  {alternative.name ? ` — ${alternative.name}` : ""}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">Аналогов пока нет.</p>
          )}
        </section>
      )}
      {offerTitle && (
        <section className="border-t border-border p-5">
          <div className="flex items-center justify-between">
            <h3 className="font-bold">Предложения: {offerTitle}</h3>
            <button
              type="button"
              className="text-sm text-muted-foreground"
              onClick={() => setOfferTitle("")}
            >
              Закрыть
            </button>
          </div>
          {offerItems.length ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="p-2">Склад</th>
                    <th className="p-2">Поставщик</th>
                    <th className="p-2">Цена</th>
                    <th className="p-2">Наличие</th>
                    <th className="p-2">Срок</th>
                    <th className="p-2">Артикул поставщика</th>
                    <th className="p-2">Статус</th>
                    <th className="p-2">Обновлено</th>
                  </tr>
                </thead>
                <tbody>
                  {offerItems.map((offer) => (
                    <tr
                      key={`${offer.warehouse}-${offer.supplier ?? ""}`}
                      className="border-b border-border"
                    >
                      <td className="p-2">{offer.warehouse}</td>
                      <td className="p-2">{offer.supplier ?? "—"}</td>
                      <td className="p-2">{Number(offer.price).toLocaleString("uk-UA")} ₴</td>
                      <td className="p-2">{offer.stock}</td>
                      <td className="p-2">
                        {offer.lead_time_days == null ? "—" : `${offer.lead_time_days} дн.`}
                      </td>
                      <td className="p-2">{offer.supplier_article ?? "—"}</td>
                      <td className="p-2">{offer.status}</td>
                      <td className="p-2">{new Date(offer.updated_at).toLocaleString("ru-RU")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">Предложений пока нет.</p>
          )}
        </section>
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
    deleteMissing?: boolean;
    columnMapping?: Record<string, string>;
  };
  has_credentials: boolean;
  last_updated_at: string | Date | null;
  last_import_at: string | Date | null;
  last_import_status: string;
  auto_update_enabled: boolean;
  update_frequency: string;
  update_time: string;
  update_timezone: string;
  next_update_at: string | Date | null;
  source_last_error: string | null;
  source_request_params: Record<string, string | number | boolean | null>;
  email_protocol: string;
  email_folder: string;
  email_from: string | null;
  email_subject: string | null;
  email_attachment_pattern: string | null;
  email_allowed_extensions: string[];
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
    columnMapping: Record<string, string>;
  };
  apiKey: string;
  login: string;
  password: string;
  clearCredentials: boolean;
  autoUpdateEnabled: boolean;
  updateFrequency: "hourly" | "daily" | "weekly";
  updateTime: string;
  updateTimezone: string;
  sourceRequestParams: Record<string, unknown>;
  emailProtocol: "imap";
  emailFolder: string;
  emailFrom: string;
  emailSubject: string;
  emailAttachmentPattern: string;
  emailAllowedExtensions: ("csv" | "xlsx" | "xls")[];
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
      columnMapping: {
        article: "",
        brand: "",
        name: "",
        price: "",
        stock: "",
        lead_time: "",
        supplier_article: "",
        oem: "",
        weight: "",
        size: "",
        image: "",
        category: "",
      },
    },
    apiKey: "",
    login: "",
    password: "",
    clearCredentials: false,
    autoUpdateEnabled: false,
    updateFrequency: "daily",
    updateTime: "03:00",
    updateTimezone: "UTC",
    sourceRequestParams: {},
    emailProtocol: "imap",
    emailFolder: "INBOX",
    emailFrom: "",
    emailSubject: "",
    emailAttachmentPattern: "",
    emailAllowedExtensions: ["csv", "xlsx", "xls"],
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
  const [sourceRequestText, setSourceRequestText] = useState("{}");

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
        const warehousesResult = warehouseResult as {
          configured: boolean;
          items: WarehouseRow[];
          nextCursor: string | null;
        };
        setConfigured(warehousesResult.configured);
        setItems(warehousesResult.items);
        setNextCursor(warehousesResult.nextCursor);
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
  const startNew = () => {
    setSourceRequestText("{}");
    setForm(emptyWarehouseForm());
  };
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
    initial.autoUpdateEnabled = warehouse.auto_update_enabled;
    initial.updateFrequency = warehouse.update_frequency as WarehouseForm["updateFrequency"];
    initial.updateTime = warehouse.update_time?.slice(0, 5) ?? "03:00";
    initial.updateTimezone = warehouse.update_timezone || "UTC";
    initial.sourceRequestParams = warehouse.source_request_params ?? {};
    setSourceRequestText(JSON.stringify(initial.sourceRequestParams, null, 2));
    initial.emailProtocol = (warehouse.email_protocol as WarehouseForm["emailProtocol"]) || "imap";
    initial.emailFolder = warehouse.email_folder || "INBOX";
    initial.emailFrom = warehouse.email_from || "";
    initial.emailSubject = warehouse.email_subject || "";
    initial.emailAttachmentPattern = warehouse.email_attachment_pattern || "";
    initial.emailAllowedExtensions = (warehouse.email_allowed_extensions || [
      "csv",
      "xlsx",
      "xls",
    ]) as WarehouseForm["emailAllowedExtensions"];
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
  const changeMapping = (field: string, value: string) => {
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
      let sourceRequestParams: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(sourceRequestText) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
          throw new Error("object required");
        sourceRequestParams = parsed as Record<string, unknown>;
      } catch {
        setError("Параметры запроса должны быть корректным JSON-объектом.");
        return;
      }
      const formData = { ...form, sourceRequestParams };
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
            {form.sourceType === "api" && (
              <label className="grid gap-1 text-sm font-semibold sm:col-span-2">
                Параметры запроса (JSON)
                <textarea
                  value={sourceRequestText}
                  onChange={(event) => setSourceRequestText(event.target.value)}
                  placeholder='{"format":"csv"}'
                  className="min-h-20 rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs font-normal"
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

          {form.sourceType !== "manual_upload" && (
            <section className="grid gap-3 rounded-lg border border-border bg-muted/20 p-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <h3 className="text-sm font-extrabold">Автоматическое обновление</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Источник проверяется в фоновой задаче, ошибки не блокируют сайт.
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input
                  type="checkbox"
                  checked={form.autoUpdateEnabled}
                  onChange={(event) => setField("autoUpdateEnabled", event.target.checked)}
                  className="size-4 accent-primary"
                />
                Включить автообновление
              </label>
              <label className="grid gap-1 text-sm font-semibold">
                Периодичность
                <select
                  value={form.updateFrequency}
                  onChange={(event) =>
                    setField(
                      "updateFrequency",
                      event.target.value as WarehouseForm["updateFrequency"],
                    )
                  }
                  className="h-10 rounded-lg border border-input bg-background px-3 font-normal"
                >
                  <option value="hourly">Каждый час</option>
                  <option value="daily">Каждый день</option>
                  <option value="weekly">Каждую неделю</option>
                </select>
              </label>
              <label className="grid gap-1 text-sm font-semibold">
                Время
                <input
                  type="time"
                  value={form.updateTime}
                  onChange={(event) => setField("updateTime", event.target.value)}
                  className="h-10 rounded-lg border border-input bg-background px-3 font-normal"
                />
              </label>
              <label className="grid gap-1 text-sm font-semibold">
                Часовой пояс
                <input
                  value={form.updateTimezone}
                  onChange={(event) => setField("updateTimezone", event.target.value)}
                  placeholder="Europe/Kyiv"
                  className="h-10 rounded-lg border border-input bg-background px-3 font-normal"
                />
              </label>
              {form.sourceType === "email" && (
                <>
                  <label className="grid gap-1 text-sm font-semibold">
                    Протокол
                    <select
                      value={form.emailProtocol}
                      onChange={(event) =>
                        setField(
                          "emailProtocol",
                          event.target.value as WarehouseForm["emailProtocol"],
                        )
                      }
                      className="h-10 rounded-lg border border-input bg-background px-3 font-normal"
                    >
                      <option value="imap">IMAP</option>
                    </select>
                  </label>
                  <label className="grid gap-1 text-sm font-semibold">
                    Папка
                    <input
                      value={form.emailFolder}
                      onChange={(event) => setField("emailFolder", event.target.value)}
                      className="h-10 rounded-lg border border-input bg-background px-3 font-normal"
                    />
                  </label>
                  <label className="grid gap-1 text-sm font-semibold">
                    IMAP host:port
                    <input
                      value={
                        String(form.sourceRequestParams["host"] ?? "") +
                        (form.sourceRequestParams["port"]
                          ? `:${String(form.sourceRequestParams["port"])}`
                          : "")
                      }
                      onChange={(event) => {
                        const [host, port] = event.target.value.split(":");
                        setField("sourceRequestParams", {
                          ...form.sourceRequestParams,
                          host,
                          port: port ? Number(port) : 993,
                        });
                      }}
                      placeholder="imap.example.com:993"
                      className="h-10 rounded-lg border border-input bg-background px-3 font-normal"
                    />
                  </label>
                  <label className="grid gap-1 text-sm font-semibold">
                    Отправитель
                    <input
                      type="email"
                      value={form.emailFrom}
                      onChange={(event) => setField("emailFrom", event.target.value)}
                      className="h-10 rounded-lg border border-input bg-background px-3 font-normal"
                    />
                  </label>
                  <label className="grid gap-1 text-sm font-semibold">
                    Тема содержит
                    <input
                      value={form.emailSubject}
                      onChange={(event) => setField("emailSubject", event.target.value)}
                      className="h-10 rounded-lg border border-input bg-background px-3 font-normal"
                    />
                  </label>
                  <label className="grid gap-1 text-sm font-semibold sm:col-span-2">
                    Шаблон имени вложения
                    <input
                      value={form.emailAttachmentPattern}
                      onChange={(event) => setField("emailAttachmentPattern", event.target.value)}
                      placeholder="price.*\.(csv|xlsx)"
                      className="h-10 rounded-lg border border-input bg-background px-3 font-normal"
                    />
                  </label>
                </>
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
              {(
                [
                  "article",
                  "brand",
                  "name",
                  "price",
                  "stock",
                  "lead_time",
                  "supplier_article",
                ] as const
              ).map((column) => (
                <label key={column} className="grid gap-1 text-xs font-semibold">
                  {
                    {
                      article: "Колонка артикула",
                      brand: "Колонка бренда",
                      name: "Колонка названия",
                      price: "Колонка цены",
                      stock: "Колонка остатка",
                      lead_time: "Срок поставки",
                      supplier_article: "Артикул поставщика",
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
                  {warehouse.auto_update_enabled && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Следующее обновление:{" "}
                      {warehouse.next_update_at
                        ? formatDate(warehouse.next_update_at)
                        : "ожидает очереди"}{" "}
                      · {warehouse.update_frequency}, {warehouse.update_time}
                    </p>
                  )}
                  {warehouse.source_last_error && (
                    <p className="mt-1 text-xs text-destructive">
                      Ошибка источника: {warehouse.source_last_error}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 self-start lg:self-center">
                  <button
                    type="button"
                    onClick={() => edit(warehouse)}
                    className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm font-bold hover:bg-muted"
                  >
                    <Pencil className="size-4" /> Настроить
                  </button>
                  {warehouse.source_type !== "manual_upload" && (
                    <button
                      type="button"
                      onClick={() =>
                        void triggerSourceUpdate(warehouse.id)
                          .then(() => setRefreshKey((key) => key + 1))
                          .catch((caught: unknown) =>
                            setError(
                              caught instanceof Error
                                ? caught.message
                                : "Не удалось поставить обновление",
                            ),
                          )
                      }
                      className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm font-bold hover:bg-muted"
                    >
                      Проверить сейчас
                    </button>
                  )}
                </div>
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

const importMappingFields = [
  { key: "brand", label: "Бренд", required: true },
  { key: "article", label: "Артикул", required: true },
  { key: "name", label: "Описание", required: false },
  { key: "price", label: "Цена", required: false },
  { key: "stock", label: "Наличие", required: false },
  { key: "lead_time", label: "Срок поставки", required: false },
  { key: "supplier_article", label: "Артикул поставщика", required: false },
  { key: "oem", label: "OEM", required: false },
  { key: "weight", label: "Вес", required: false },
  { key: "size", label: "Размер", required: false },
  { key: "image", label: "Изображение", required: false },
  { key: "category", label: "Категория", required: false },
] as const;

type ImportWarehouse = Pick<WarehouseRow, "id" | "name" | "price_format" | "import_settings">;
type ImportPreview = {
  rows: string[][];
  fields: { key: string; label: string; column: string; sample: string }[];
  errors: string[];
  delimiter: string;
  headers: boolean;
  tempFileId?: string;
  estimatedRows?: number;
  safetyWarnings?: string[];
};

function WarehouseImportSettings() {
  const [warehouses, setWarehouses] = useState<ImportWarehouse[]>([]);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [warehouseId, setWarehouseId] = useState("");
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [delimiter, setDelimiter] = useState<"auto" | "comma" | "semicolon" | "tab">("auto");
  const [encoding, setEncoding] = useState<"utf-8" | "windows-1251">("utf-8");
  const [firstRowHeaders, setFirstRowHeaders] = useState(true);
  const [deleteMissing, setDeleteMissing] = useState(false);
  const [safetyConfirmed, setSafetyConfirmed] = useState(false);
  const [columnStyle, setColumnStyle] = useState<"letters" | "numbers">("numbers");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [extraLabel, setExtraLabel] = useState("");
  const [extraKeys, setExtraKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [importRun, setImportRun] = useState<{
    id: string;
    status: string;
    rowsTotal?: number;
    rowsProcessed?: number;
    rowsCreated?: number;
    rowsUpdated?: number;
    rowsSkipped?: number;
    rowsDuplicate?: number;
    errorCount?: number;
    durationMs?: number | null;
  } | null>(null);
  const [runErrors, setRunErrors] = useState<
    { id: string; row_number: number; raw_value: string | null; message: string }[]
  >([]);
  const [startingImport, setStartingImport] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void listAdminWarehouses({
      data: { search: submittedSearch || undefined, sort: "name", limit: 100 },
    })
      .then((result) => {
        if (cancelled) return;
        const warehousesResult = result as { configured: boolean; items: ImportWarehouse[] };
        setConfigured(warehousesResult.configured);
        setWarehouses(warehousesResult.items);
        if (
          warehouseId &&
          !warehousesResult.items.some((warehouse) => warehouse.id === warehouseId)
        ) {
          setWarehouseId("");
        }
      })
      .catch(() => {
        if (!cancelled) setError("Не удалось загрузить список складов.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [submittedSearch, warehouseId]);

  const selectedWarehouse = warehouses.find((warehouse) => warehouse.id === warehouseId);

  const selectWarehouse = (id: string) => {
    setWarehouseId(id);
    setPreview(null);
    setFile(null);
    setError("");
    setMessage("");
    const warehouse = warehouses.find((item) => item.id === id);
    const settings = warehouse?.import_settings;
    setMapping({ ...(settings?.columnMapping ?? {}) });
    setDelimiter((settings?.delimiter as typeof delimiter) ?? "auto");
    setEncoding((settings?.encoding as typeof encoding) ?? "utf-8");
    setFirstRowHeaders(settings?.firstRowHeaders ?? true);
    setDeleteMissing(settings?.deleteMissing ?? false);
    setSafetyConfirmed(false);
    setExtraKeys(
      Object.keys(settings?.columnMapping ?? {}).filter(
        (key) =>
          !importMappingFields.some((field) => field.key === key) && key.startsWith("custom_"),
      ),
    );
    const format = warehouse?.price_format;
    setColumnStyle(format === "xlsx" || format === "xls" ? "letters" : "numbers");
  };

  const updateMapping = (key: string, value: string) => {
    setMapping((current) => ({ ...current, [key]: value }));
    setPreview(null);
    setMessage("");
  };

  const addCustomField = () => {
    const label = extraLabel.trim();
    if (!label) return;
    const key = `custom_${label}_${Date.now()}`;
    setExtraKeys((current) => [...current, key]);
    setMapping((current) => ({ ...current, [key]: "" }));
    setExtraLabel("");
    setPreview(null);
  };

  const save = async () => {
    if (!selectedWarehouse) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await saveWarehouseImportSettings({
        data: {
          id: selectedWarehouse.id,
          importSettings: {
            delimiter,
            encoding,
            firstRowHeaders,
            deleteMissing,
            columnMapping: mapping,
          },
        },
      });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMessage("Схема колонок сохранена для этого склада.");
      setWarehouses((current) =>
        current.map((warehouse) =>
          warehouse.id === selectedWarehouse.id
            ? {
                ...warehouse,
                import_settings: {
                  delimiter,
                  encoding,
                  firstRowHeaders,
                  deleteMissing,
                  columnMapping: mapping,
                },
              }
            : warehouse,
        ),
      );
    } catch {
      setError("Не удалось сохранить схему. Проверьте соединение с базой данных.");
    } finally {
      setSaving(false);
    }
  };

  const chooseFile = (selected: File | undefined) => {
    setFile(selected ?? null);
    setPreview(null);
    setError("");
    setMessage("");
    if (selected) setColumnStyle(/\.(xlsx|xls)$/i.test(selected.name) ? "letters" : "numbers");
  };

  const checkFile = async () => {
    if (!file || !selectedWarehouse) return;
    setChecking(true);
    setError("");
    setMessage("");
    setPreview(null);
    try {
      const response = await fetch(
        `/api/admin/import/upload?warehouseId=${encodeURIComponent(selectedWarehouse.id)}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/octet-stream",
            "x-file-name": encodeURIComponent(file.name),
          },
          body: file,
        },
      );
      const result = await response.json();
      if (!response.ok || !result.ok)
        throw new Error(result.error || "Не удалось обработать прайс");
      const headers = firstRowHeaders ? (result.rows[0] ?? []) : [];
      const rows = result.rows as string[][];
      const dataRows = rows.slice(firstRowHeaders ? 1 : 0);
      const fields = importMappingFields.map((field) => {
        const selected = result.mapping?.[field.key] ?? mapping[field.key] ?? "";
        const index =
          columnStyle === "letters" ? excelColumnIndex(selected) : numericColumnIndex(selected);
        const headerIndex = headers.findIndex(
          (header: string) => header.trim().toLowerCase() === String(selected).trim().toLowerCase(),
        );
        const resolvedIndex = index >= 0 ? index : headerIndex;
        return {
          key: field.key,
          label: field.label,
          column:
            resolvedIndex >= 0
              ? `${columnNameForIndex(resolvedIndex)}${headers[resolvedIndex] ? ` · ${headers[resolvedIndex]}` : ""}`
              : "Не найдено",
          sample: resolvedIndex >= 0 ? dataRows[0]?.[resolvedIndex] || "НЕТ" : "НЕТ",
        };
      });
      setPreview({
        rows: rows.slice(0, 11),
        fields,
        errors: result.errors ?? [],
        delimiter: result.format.toUpperCase(),
        headers: firstRowHeaders,
        tempFileId: result.tempFileId,
        estimatedRows: result.estimatedRows,
        safetyWarnings: result.safetyWarnings ?? [],
      });
      setSafetyConfirmed(false);
      setMessage(
        result.errors?.length
          ? "Проверка обнаружила проблемы. Исправьте схему склада и загрузите файл повторно."
          : "Файл проверен сервером. Можно запустить импорт.",
      );
      return;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось прочитать файл.");
    } finally {
      setChecking(false);
    }
  };

  const startImport = async () => {
    if (!preview?.tempFileId || !selectedWarehouse) return;
    setStartingImport(true);
    setError("");
    try {
      const response = await fetch("/api/admin/import/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tempFileId: preview.tempFileId,
          warehouseId: selectedWarehouse.id,
          confirmSafety: safetyConfirmed,
        }),
      });
      const result = await response.json();
      if (response.status === 409 && result.requiresConfirmation) {
        setError("Требуется подтверждение предупреждения безопасности.");
        setSafetyConfirmed(true);
        return;
      }
      if (!response.ok || !result.ok)
        throw new Error(result.error || "Не удалось запустить импорт");
      setImportRun({ id: result.runId, status: "queued" });
      setMessage("Импорт запущен в фоновом режиме.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось запустить импорт");
    } finally {
      setStartingImport(false);
    }
  };

  useEffect(() => {
    if (
      !importRun?.id ||
      ["completed", "completed_with_errors", "failed"].includes(importRun.status)
    )
      return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch(
          `/api/admin/import/status?runId=${encodeURIComponent(importRun.id)}`,
          { cache: "no-store" },
        );
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error);
        if (!cancelled) {
          setImportRun(result.run);
          setRunErrors(result.errors ?? []);
          if (!["completed", "completed_with_errors", "failed"].includes(result.run.status))
            timer = setTimeout(poll, 1500);
        }
      } catch {
        if (!cancelled) timer = setTimeout(poll, 3000);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [importRun?.id, importRun?.status]);

  return (
    <div className="grid gap-5">
      <section className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <FileSpreadsheet className="size-5" />
          </span>
          <div>
            <h2 className="text-lg font-extrabold">Схема колонок для склада</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Настройка хранится отдельно у каждого склада. Для Excel указывайте букву столбца (A,
              B, AA), для CSV — номер (1, 2, 3).
            </p>
          </div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
          <label className="grid gap-1 text-sm font-semibold">
            Найти склад
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Например, Автотехникс Троещина"
              className="h-10 rounded-lg border border-input bg-background px-3 font-normal"
            />
          </label>
          <button
            type="button"
            onClick={() => setSubmittedSearch(search.trim())}
            className="self-end rounded-lg border border-border px-4 py-2.5 text-sm font-bold hover:bg-muted"
          >
            Найти склад
          </button>
        </div>
        <label className="mt-3 grid gap-1 text-sm font-semibold">
          Склад
          <select
            value={warehouseId}
            onChange={(event) => selectWarehouse(event.target.value)}
            disabled={loading || configured === false}
            className="h-11 rounded-lg border border-input bg-background px-3 font-normal"
          >
            <option value="">Выберите склад</option>
            {warehouses.map((warehouse) => (
              <option key={warehouse.id} value={warehouse.id}>
                {warehouse.name}
              </option>
            ))}
          </select>
        </label>
        {configured === false && (
          <p className="mt-3 text-sm text-muted-foreground">
            Подключите PostgreSQL, чтобы сохранять настройки складов.
          </p>
        )}
      </section>

      {selectedWarehouse && (
        <>
          <section className="grid gap-4 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-6">
            <div>
              <h2 className="text-lg font-extrabold">
                Соответствие колонок · {selectedWarehouse.name}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Обязательны бренд и артикул, а также цена или наличие. Пустые необязательные поля
                будут иметь значение «НЕТ».
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <label className="grid gap-1 text-sm font-semibold">
                Формат колонок
                <select
                  value={columnStyle}
                  onChange={(event) => {
                    setColumnStyle(event.target.value as typeof columnStyle);
                    setPreview(null);
                  }}
                  className="h-10 rounded-lg border border-input bg-background px-3 font-normal"
                >
                  <option value="numbers">CSV / разделитель · 1, 2, 3…</option>
                  <option value="letters">Excel · A, B, C…</option>
                </select>
              </label>
              <label className="grid gap-1 text-sm font-semibold">
                Разделитель CSV
                <select
                  value={delimiter}
                  onChange={(event) => {
                    setDelimiter(event.target.value as typeof delimiter);
                    setPreview(null);
                  }}
                  className="h-10 rounded-lg border border-input bg-background px-3 font-normal"
                >
                  <option value="auto">Определять автоматически</option>
                  <option value="comma">Запятая</option>
                  <option value="semicolon">Точка с запятой</option>
                  <option value="tab">Табуляция</option>
                </select>
              </label>
              <label className="grid gap-1 text-sm font-semibold">
                Кодировка CSV
                <select
                  value={encoding}
                  onChange={(event) => {
                    setEncoding(event.target.value as typeof encoding);
                    setPreview(null);
                  }}
                  className="h-10 rounded-lg border border-input bg-background px-3 font-normal"
                >
                  <option value="utf-8">UTF-8</option>
                  <option value="windows-1251">Windows-1251</option>
                </select>
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={firstRowHeaders}
                onChange={(event) => {
                  setFirstRowHeaders(event.target.checked);
                  setPreview(null);
                }}
                className="size-4 accent-primary"
              />{" "}
              Первая строка содержит заголовки
            </label>
            <label className="flex items-start gap-2 rounded-lg border border-amber-300/60 bg-amber-50 p-3 text-sm font-semibold text-amber-950">
              <input
                type="checkbox"
                checked={deleteMissing}
                onChange={(event) => setDeleteMissing(event.target.checked)}
                className="mt-0.5 size-4 accent-primary"
              />
              <span>
                Удалять позиции, отсутствующие в новом прайсе
                <span className="mt-1 block text-xs font-normal">
                  По умолчанию выключено. Включайте только если поставщик гарантирует полный прайс.
                </span>
              </span>
            </label>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {importMappingFields.map((field) => (
                <label key={field.key} className="grid gap-1 text-sm font-semibold">
                  {field.label}
                  {field.required ? " · обязательно" : " · необязательно"}
                  <input
                    value={mapping[field.key] ?? ""}
                    onChange={(event) => updateMapping(field.key, event.target.value)}
                    placeholder={columnStyle === "letters" ? "Например, A" : "Например, 1"}
                    className="h-10 rounded-lg border border-input bg-background px-3 font-normal"
                  />
                </label>
              ))}
              {extraKeys.map((key, index) => (
                <div key={key} className="grid gap-1 text-sm font-semibold">
                  <label htmlFor={`mapping-${key}`}>
                    Доп. поле: {customMappingLabel(key) || `№${index + 1}`}
                  </label>
                  <div className="flex gap-2">
                    <input
                      id={`mapping-${key}`}
                      value={mapping[key] ?? ""}
                      onChange={(event) => updateMapping(key, event.target.value)}
                      placeholder={columnStyle === "letters" ? "Например, H" : "Например, 8"}
                      className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 font-normal"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setExtraKeys((current) => current.filter((item) => item !== key));
                        setMapping((current) => {
                          const next = { ...current };
                          delete next[key];
                          return next;
                        });
                        setPreview(null);
                      }}
                      aria-label={`Удалить поле ${customMappingLabel(key)}`}
                      className="rounded-lg border border-border px-3 text-sm font-bold text-muted-foreground hover:bg-muted"
                    >
                      Удалить
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={extraLabel}
                onChange={(event) => setExtraLabel(event.target.value)}
                placeholder="Название дополнительного поля"
                className="h-10 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm"
              />
              <button
                type="button"
                onClick={addCustomField}
                className="h-10 rounded-lg border border-border px-4 text-sm font-bold hover:bg-muted"
              >
                Добавить поле
              </button>
            </div>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="inline-flex h-10 w-fit items-center gap-2 rounded-lg bg-primary px-4 text-sm font-extrabold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              <Save className="size-4" />
              {saving ? "Сохраняем…" : "Сохранить схему склада"}
            </button>
          </section>

          <section className="grid gap-4 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-6">
            <div>
              <h2 className="text-lg font-extrabold">Проверка структуры файла</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Выберите пример прайса этого склада. Будут показаны первые строки и распознанные
                поля. Проверка не запускает импорт.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="grid flex-1 gap-1 text-sm font-semibold">
                Прайс CSV, XLSX или XLS
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={(event) => chooseFile(event.target.files?.[0])}
                  className="min-h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-normal file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1"
                />
              </label>
              <button
                type="button"
                onClick={() => void checkFile()}
                disabled={!file || checking}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-extrabold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                <FileSpreadsheet className="size-4" />
                {checking ? "Проверяем…" : "Проверить структуру файла"}
              </button>
            </div>
            {file && (
              <p className="text-xs text-muted-foreground">
                {file.name} · {(file.size / 1024 / 1024).toFixed(2)} МБ ·{" "}
                {columnStyle === "letters" ? "Excel: буквенные колонки" : "CSV: колонки по номеру"}
              </p>
            )}
          </section>
        </>
      )}

      {message && (
        <p
          role="status"
          className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm font-semibold text-primary"
        >
          {message}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      {preview && (
        <>
          <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <div className="border-b border-border p-4">
              <h2 className="font-extrabold">Распознанные поля</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Строк в файле: {preview.estimatedRows?.toLocaleString("ru-RU") ?? "—"}. Формат:{" "}
                {preview.delimiter}.
              </p>
            </div>
            <div className="grid gap-2 p-4 sm:grid-cols-2 xl:grid-cols-3">
              {preview.fields.map((field) => (
                <div key={field.key} className="min-w-0 rounded-lg border border-border p-3">
                  <p className="text-xs font-semibold text-muted-foreground">{field.label}</p>
                  <p className="mt-1 truncate text-sm font-bold">Колонка: {field.column}</p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    Пример: {field.sample}
                  </p>
                </div>
              ))}
            </div>
            <div className="overflow-x-auto border-t border-border">
              <table className="min-w-full text-left text-xs">
                <tbody>
                  {preview.rows.map((row, rowIndex) => (
                    <tr key={rowIndex} className="border-b border-border last:border-0">
                      {row.map((cell, columnIndex) => (
                        <td
                          key={columnIndex}
                          className={`max-w-64 border-r border-border px-3 py-2 ${rowIndex === 0 && preview.headers ? "bg-muted/50 font-bold" : ""}`}
                        >
                          <span className="block text-[10px] text-muted-foreground">
                            {columnNameForIndex(columnIndex)}
                          </span>
                          <span className="block truncate">{cell || "—"}</span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          {preview.errors.length > 0 && (
            <section
              role="alert"
              className="rounded-xl border border-destructive/30 bg-destructive/5 p-4"
            >
              <h3 className="font-extrabold text-destructive">Нужно исправить перед импортом</h3>
              <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-destructive">
                {preview.errors.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          )}
          {preview.safetyWarnings && preview.safetyWarnings.length > 0 && (
            <section className="rounded-xl border border-amber-400 bg-amber-50 p-4 text-amber-950">
              <h3 className="font-extrabold">Требуется подтверждение администратора</h3>
              <ul className="mt-2 list-inside list-disc space-y-1 text-sm">
                {preview.safetyWarnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
              <label className="mt-3 flex items-start gap-2 text-sm font-semibold">
                <input
                  type="checkbox"
                  checked={safetyConfirmed}
                  onChange={(event) => setSafetyConfirmed(event.target.checked)}
                  className="mt-0.5 size-4 accent-primary"
                />
                Я проверил файл и подтверждаю запуск импорта
              </label>
            </section>
          )}
          {preview.errors.length === 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4">
              <p className="text-sm font-semibold">
                Проверка пройдена. Ошибки строк уточнятся при обработке всего файла.
              </p>
              <button
                type="button"
                onClick={() => void startImport()}
                disabled={
                  startingImport ||
                  Boolean(preview.safetyWarnings?.length && !safetyConfirmed) ||
                  Boolean(
                    importRun &&
                    !["completed", "completed_with_errors", "failed"].includes(importRun.status),
                  )
                }
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-extrabold text-primary-foreground disabled:opacity-50"
              >
                {startingImport ? "Запускаем…" : "Запустить импорт"}
              </button>
            </div>
          )}
        </>
      )}
      {importRun && (
        <section className="grid gap-3 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-extrabold">
              Импорт #{importRun.id}:{" "}
              {importRun.status === "queued"
                ? "в очереди"
                : importRun.status === "running"
                  ? "выполняется"
                  : importRun.status === "completed"
                    ? "завершён"
                    : importRun.status === "completed_with_errors"
                      ? "завершён с ошибками"
                      : "ошибка"}
            </h2>
            {(importRun.errorCount ?? 0) > 0 && (
              <a
                href={"/api/admin/import/errors/download?runId=" + importRun.id}
                className="text-sm font-bold text-primary underline"
              >
                Скачать ошибки CSV
              </a>
            )}
          </div>
          <progress
            className="h-2 w-full accent-primary"
            max={Math.max(importRun.rowsTotal || preview?.estimatedRows || 1, 1)}
            value={importRun.rowsProcessed || 0}
          />
          <p className="text-sm text-muted-foreground">
            Обработано {Number(importRun.rowsProcessed || 0).toLocaleString("ru-RU")} из{" "}
            {Number(importRun.rowsTotal || preview?.estimatedRows || 0).toLocaleString("ru-RU")}{" "}
            строк
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
            {[
              ["Всего строк", importRun.rowsTotal],
              ["Добавлено", importRun.rowsCreated],
              ["Обновлено", importRun.rowsUpdated],
              ["Пропущено", importRun.rowsSkipped],
              ["Дубликаты в файле", importRun.rowsDuplicate],
              ["Ошибки", importRun.errorCount],
            ].map(([label, value]) => (
              <div key={label} className="rounded-md border border-border p-3">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-1 font-extrabold">{Number(value || 0).toLocaleString("ru-RU")}</p>
              </div>
            ))}
          </div>
          {importRun.durationMs != null && (
            <p className="text-sm text-muted-foreground">
              Время обработки: {(Number(importRun.durationMs) / 1000).toFixed(1)} с
            </p>
          )}
          {runErrors.length > 0 && (
            <ul className="max-h-52 overflow-auto rounded-md border border-border p-3 text-sm">
              {runErrors.map((item) => (
                <li key={item.id} className="border-b border-border py-2 last:border-0">
                  Строка {item.row_number}: {item.raw_value || "—"} · {item.message}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function parseDelimitedPreview(content: string, requestedDelimiter?: string) {
  const delimiter = requestedDelimiter ?? detectDelimiter(content);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = content.charCodeAt(0) === 0xfeff ? 1 : 0; index < content.length; index += 1) {
    const character = content[index]!;
    if (character === '"') {
      if (quoted && content[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && content[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      if (rows.length >= 11) break;
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (rows.length < 11 && (cell || row.length)) {
    row.push(cell);
    rows.push(row);
  }
  return { rows, delimiter };
}

function detectDelimiter(content: string): string {
  const sample = content.split(/\r?\n/, 2)[0] ?? "";
  const candidates = [",", ";", "\t"];
  return (
    candidates.sort((left, right) => sample.split(right).length - sample.split(left).length)[0] ??
    ","
  );
}

function contentForDelimiter(rows: string[][]): string {
  return rows[0]?.join(",") ?? "";
}

function customMappingLabel(key: string): string {
  return key.replace(/^custom_/, "").replace(/_\d+$/, "");
}

function excelColumnIndex(value: string): number {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{1,3}$/.test(normalized)) return -1;
  let index = 0;
  for (const character of normalized) index = index * 26 + character.charCodeAt(0) - 64;
  return index - 1;
}

function numericColumnIndex(value: string): number {
  const number = Number(value.trim());
  return Number.isInteger(number) && number > 0 ? number - 1 : -1;
}

function columnNameForIndex(index: number): string {
  let number = index + 1;
  let name = "";
  while (number > 0) {
    const remainder = (number - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    number = Math.floor((number - 1) / 26);
  }
  return name;
}

function findHeaderIndex(headers: string[], key: string, label: string): number {
  const aliases: Record<string, string[]> = {
    brand: ["brand", "бренд", "марка", "виробник", "производитель"],
    article: ["article", "артикул", "номер", "код", "part number", "partnumber", "sku"],
    name: ["name", "description", "описание", "название", "наименование", "найменування", "опис"],
    price: ["price", "цена", "ціна", "стоимость"],
    stock: ["stock", "quantity", "наличие", "остаток", "количество", "кількість"],
    oem: ["oem", "oe", "оригинальный номер"],
    weight: ["weight", "вес", "вага"],
    size: ["size", "размер", "розмір", "dimensions"],
    image: ["image", "фото", "изображение", "картинка", "зображення"],
    category: ["category", "категория", "категорія"],
  };
  const names = [label.toLowerCase(), ...(aliases[key] ?? [])];
  return headers.findIndex((header) => {
    const normalized = header
      .trim()
      .toLowerCase()
      .replace(/[._-]+/g, " ");
    return names.some((name) => normalized === name || normalized.includes(name));
  });
}

type ImportHistoryRun = {
  id: string;
  filename: string;
  status: string;
  warehouseName: string | null;
  supplierName: string | null;
  source: string | null;
  startedBy: string | null;
  retryOfRunId: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  rowsTotal: number;
  rowsCreated: number;
  rowsUpdated: number;
  rowsSkipped: number;
  rowsDuplicate: number;
  errorCount: number;
  summary: string | null;
};

function importHistoryStatusLabel(status: string): string {
  return (
    (
      {
        queued: "Ожидание",
        running: "В процессе",
        completed: "Завершено",
        completed_with_errors: "Завершено с ошибками",
        failed: "Ошибка",
      } as Record<string, string>
    )[status] ?? status
  );
}

function ImportHistorySection() {
  const [runs, setRuns] = useState<ImportHistoryRun[]>([]);
  const [selected, setSelected] = useState<ImportHistoryRun | null>(null);
  const [errors, setErrors] = useState<
    Array<{
      id: string;
      row_number: number | null;
      raw_value: string | null;
      code: string;
      message: string;
    }>
  >([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [filename, setFilename] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const load = useCallback(
    async (next: string | null = null) => {
      setLoading(true);
      if (next === null) setCursorStack([]);
      try {
        const query = new URLSearchParams({ limit: "25" });
        if (next) query.set("before", next);
        if (filename.trim()) query.set("filename", filename.trim());
        if (statusFilter) query.set("status", statusFilter);
        const response = await fetch(`/api/admin/import/history?${query.toString()}`, {
          cache: "no-store",
        });
        const body = (await response.json()) as {
          ok?: boolean;
          runs?: ImportHistoryRun[];
          nextCursor?: string | null;
          error?: string;
        };
        if (!response.ok || !body.ok) throw new Error(body.error ?? "Не удалось загрузить историю");
        setRuns(body.runs ?? []);
        setNextCursor(body.nextCursor ?? null);
        setCursor(next);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Ошибка загрузки истории");
      } finally {
        setLoading(false);
      }
    },
    [filename, statusFilter],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const open = async (run: ImportHistoryRun) => {
    setSelected(run);
    setErrors([]);
    const response = await fetch(`/api/admin/import/status?runId=${encodeURIComponent(run.id)}`, {
      cache: "no-store",
    });
    const body = (await response.json()) as {
      ok?: boolean;
      run?: ImportHistoryRun;
      errors?: typeof errors;
    };
    if (body.ok) {
      setSelected(body.run ?? run);
      setErrors(body.errors ?? []);
    }
  };
  const retry = async (run: ImportHistoryRun) => {
    setStatus("");
    const response = await fetch("/api/admin/import/retry", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: run.id }),
    });
    const body = (await response.json()) as { ok?: boolean; runId?: string; error?: string };
    if (!response.ok || !body.ok) {
      setStatus(body.error ?? "Не удалось повторить импорт");
      return;
    }
    setStatus(`Повторный импорт #${body.runId} поставлен в очередь`);
    void load(cursor);
  };
  const goPrevious = () => {
    const previous = cursorStack.at(-1) ?? null;
    setCursorStack((items) => items.slice(0, -1));
    void load(previous);
  };
  const goNext = () => {
    if (!nextCursor) return;
    setCursorStack((items) => (cursor == null ? items : [...items, cursor]));
    void load(nextCursor);
  };
  return (
    <div className="grid gap-5">
      <section className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="grid flex-1 gap-1 text-sm font-semibold">
            Файл
            <input
              value={filename}
              onChange={(event) => setFilename(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void load();
              }}
              placeholder="Название файла"
              className="h-10 rounded-lg border border-input bg-background px-3 font-normal"
            />
          </label>
          <label className="grid gap-1 text-sm font-semibold sm:w-56">
            Статус
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="h-10 rounded-lg border border-input bg-background px-3 font-normal"
            >
              <option value="">Все статусы</option>
              <option value="queued">Ожидание</option>
              <option value="running">В процессе</option>
              <option value="completed">Завершено</option>
              <option value="completed_with_errors">С ошибками</option>
              <option value="failed">Ошибка</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => void load()}
            className="h-10 rounded-lg border border-border px-4 text-sm font-bold hover:bg-muted"
          >
            Обновить
          </button>
        </div>
      </section>
      {status && (
        <p
          role="status"
          className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm font-semibold text-primary"
        >
          {status}
        </p>
      )}
      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {loading ? (
          <p className="p-5 text-sm text-muted-foreground">Загружаем…</p>
        ) : runs.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">Импортов пока нет.</p>
        ) : (
          <div className="divide-y divide-border">
            {runs.map((run) => (
              <article
                key={run.id}
                className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate font-extrabold">
                      #{run.id} · {run.filename}
                    </h3>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-bold">
                      {importHistoryStatusLabel(run.status)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {run.warehouseName ?? "Склад не указан"} ·{" "}
                    {run.supplierName ?? "Поставщик не указан"} · {run.source ?? "—"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Строк: {run.rowsTotal.toLocaleString("ru-RU")} · новых {run.rowsCreated} ·
                    обновлено {run.rowsUpdated} · ошибок {run.errorCount} · {run.startedBy ?? "—"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void open(run)}
                    className="h-9 rounded-lg border border-border px-3 text-sm font-bold hover:bg-muted"
                  >
                    Открыть
                  </button>
                  {run.errorCount > 0 && (
                    <a
                      href={`/api/admin/import/errors/download?runId=${run.id}`}
                      className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-sm font-bold hover:bg-muted"
                    >
                      Скачать ошибки
                    </a>
                  )}
                  {["failed", "completed_with_errors"].includes(run.status) && (
                    <button
                      type="button"
                      onClick={() => void retry(run)}
                      className="h-9 rounded-lg bg-primary px-3 text-sm font-bold text-primary-foreground hover:bg-primary/90"
                    >
                      Повторить
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
        <PaginationFooter
          pageSize={25}
          canPrevious={Boolean(cursor)}
          canNext={Boolean(nextCursor)}
          loading={loading}
          onPrevious={goPrevious}
          onNext={goNext}
        />
      </section>
      {selected && (
        <section className="grid gap-3 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-extrabold">Импорт #{selected.id}</h2>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="h-9 rounded-lg border border-border px-3 text-sm font-bold hover:bg-muted"
            >
              Закрыть
            </button>
          </div>
          <p className="text-sm text-muted-foreground">
            {selected.warehouseName ?? "—"} · {selected.supplierName ?? "—"} · файл{" "}
            {selected.filename} · запуск: {selected.startedBy ?? "—"}
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
            {(
              [
                ["Всего строк", selected.rowsTotal],
                ["Новых", selected.rowsCreated],
                ["Обновлено", selected.rowsUpdated],
                ["Пропущено", selected.rowsSkipped],
                ["Дубликаты", selected.rowsDuplicate],
                ["Ошибки", selected.errorCount],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="rounded-md border border-border p-3">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-1 font-extrabold">{Number(value).toLocaleString("ru-RU")}</p>
              </div>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            Начало: {selected.startedAt ? formatDate(selected.startedAt) : "—"} · окончание:{" "}
            {selected.finishedAt ? formatDate(selected.finishedAt) : "—"} · длительность:{" "}
            {selected.durationMs == null ? "—" : `${(selected.durationMs / 1000).toFixed(1)} с`}
          </p>
          {selected.errorCount > 0 && (
            <a
              href={`/api/admin/import/errors/download?runId=${selected.id}`}
              className="w-fit text-sm font-bold text-primary underline"
            >
              Скачать полный CSV отчёт ошибок
            </a>
          )}
          {selected.summary && <p className="text-sm">{selected.summary}</p>}
          {errors.length > 0 && (
            <div className="rounded-lg border border-border p-3">
              <h3 className="font-bold">Ошибки</h3>
              <ul className="mt-2 max-h-64 overflow-auto text-sm">
                {errors.map((error) => (
                  <li key={error.id} className="border-b border-border py-2 last:border-0">
                    Строка {error.row_number ?? "—"}: {error.raw_value ?? "—"} · {error.code} ·{" "}
                    {error.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
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
