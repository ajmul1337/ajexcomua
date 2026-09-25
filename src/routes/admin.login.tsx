import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { getAdminStatus, loginAdmin } from "@/lib/admin-auth";
import { ArrowLeft, KeyRound, LockKeyhole } from "lucide-react";

export const Route = createFileRoute("/admin/login")({
  beforeLoad: async () => {
    const status = await getAdminStatus();
    if (status.authenticated) {
      throw redirect({ to: "/admin/" });
    }
  },
  component: AdminLoginPage,
});

function AdminLoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage("");
    setSubmitting(true);
    try {
      const result = await loginAdmin({ data: { username, password } });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      await navigate({ to: "/admin/" });
    } catch {
      setMessage(
        "Помилка налаштування авторизації на сервері. Перевірте підключення PostgreSQL та ADMIN_SESSION_SECRET у Vercel.",
      );
    } finally {
      setSubmitting(false);
    }
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
          <LockKeyhole className="size-6" />
        </div>
        <p className="mt-5 text-xs font-extrabold uppercase text-primary">AJEX</p>
        <h1 className="mt-1 text-2xl font-extrabold">Вхід адміністратора</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Увійдіть, щоб відкрити захищену адміністративну частину.
        </p>
        <form onSubmit={submit} className="mt-6 grid gap-4">
          <label className="grid gap-1.5 text-sm font-semibold">
            Логін
            <span className="relative">
              <KeyRound className="absolute left-3 top-3.5 size-4 text-muted-foreground" />
              <input
                autoComplete="username"
                required
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="h-11 w-full rounded-md border border-input bg-background pl-10 pr-3"
              />
            </span>
          </label>
          <label className="grid gap-1.5 text-sm font-semibold">
            Пароль
            <input
              autoComplete="current-password"
              type="password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-11 rounded-md border border-input bg-background px-3"
            />
          </label>
          {message && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {message}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-4 text-sm font-extrabold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            {submitting ? "Перевіряємо…" : "Увійти"}
          </button>
        </form>
      </section>
    </main>
  );
}
