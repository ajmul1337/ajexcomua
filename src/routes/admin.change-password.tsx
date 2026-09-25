import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { changeAdminPassword, getAdminStatus, logoutAdmin } from "@/lib/admin-auth";
import { ArrowLeft, KeyRound } from "lucide-react";

export const Route = createFileRoute("/admin/change-password")({
  beforeLoad: async () => {
    const status = await getAdminStatus();
    if (!status.authenticated) throw redirect({ to: "/admin/login" });
    if (status.role !== "admin") throw redirect({ to: "/admin/login" });
  },
  component: ChangeAdminPasswordPage,
});

function ChangeAdminPasswordPage() {
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage("");
    if (newPassword !== confirmation) {
      setMessage("Нові паролі не збігаються.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await changeAdminPassword({ data: { currentPassword, newPassword } });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setSuccess(true);
      setMessage("Пароль змінено. Новий пароль діятиме під час наступного входу.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmation("");
    } catch {
      setMessage("Не вдалося змінити пароль. Перевірте підключення PostgreSQL та секрет сесії.");
    } finally {
      setSubmitting(false);
    }
  };

  const logout = async () => {
    await logoutAdmin();
    await navigate({ to: "/admin/login" });
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <section className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <a
          href="/"
          className="inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> На сайт AJEX
        </a>
        <div className="mt-8 flex size-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <KeyRound className="size-6" />
        </div>
        <p className="mt-5 text-xs font-extrabold uppercase text-primary">
          Безпека облікового запису
        </p>
        <h1 className="mt-1 text-2xl font-extrabold">Зміна пароля</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          За бажанням встановіть новий пароль щонайменше з 12 символів. Зміна пароля не є
          обов’язковою для входу до адмін-панелі.
        </p>
        <form onSubmit={submit} className="mt-6 grid gap-4">
          <label className="grid gap-1.5 text-sm font-semibold">
            Поточний пароль
            <input
              autoComplete="current-password"
              type="password"
              required
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              className="h-11 rounded-md border border-input bg-background px-3"
            />
          </label>
          <label className="grid gap-1.5 text-sm font-semibold">
            Новий пароль
            <input
              autoComplete="new-password"
              type="password"
              required
              minLength={12}
              maxLength={256}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              className="h-11 rounded-md border border-input bg-background px-3"
            />
          </label>
          <label className="grid gap-1.5 text-sm font-semibold">
            Повторіть новий пароль
            <input
              autoComplete="new-password"
              type="password"
              required
              minLength={12}
              maxLength={256}
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              className="h-11 rounded-md border border-input bg-background px-3"
            />
          </label>
          {message && (
            <p
              role="status"
              className={`text-sm font-medium ${success ? "text-success" : "text-destructive"}`}
            >
              {message}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-extrabold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            {submitting ? "Зберігаємо…" : "Змінити пароль"}
          </button>
          {success && (
            <button
              type="button"
              onClick={logout}
              className="h-10 rounded-md border border-border text-sm font-bold hover:bg-muted"
            >
              Вийти з аккаунта
            </button>
          )}
        </form>
      </section>
    </main>
  );
}
