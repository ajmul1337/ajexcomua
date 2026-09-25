# AJEX administrator authentication

## PostgreSQL storage

Authentication always uses PostgreSQL; the app does not read or write `.data` files. On Vercel, set one PostgreSQL connection variable: `DATABASE_URL`, `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, or `POSTGRES_URL_NON_POOLING`. The code accepts the standard Vercel Postgres connection variable names.

The first authentication request creates `ajex_admin_accounts` and `ajex_admin_login_attempts` if needed. The same definitions are in `db/migrations/0003_admin_auth.sql` and can be applied using `node db/migrate.mjs`.

`ajex_admin_accounts` stores the administrator role, PBKDF2 password hash and salt, iteration count, and account version. It never stores the plaintext password. `ajex_admin_login_attempts` stores hashed IP identifiers and short-lived login attempt counters.

## Sessions

Sessions are stateless HMAC-signed cookies, not files and not database session rows. The cookie is `HttpOnly`, `SameSite=Strict`, `Secure` in production, and expires after eight hours. The account version is checked in PostgreSQL on protected requests; changing the password increments the version and invalidates older sessions. Logout clears the cookie.

Set `ADMIN_SESSION_SECRET` in Vercel for Production and Preview, with at least 32 characters of random data. It is used only on the server and must not have a `VITE_` prefix.

## Initial login

When `ajex_admin_accounts` has no administrator row, the first login creates one with `admin` / `admin`. Existing account credentials are not overwritten. Password changes are optional and available from the admin panel.

In local development, point one of the PostgreSQL URL variables above at a development database as well; no local filesystem fallback is provided.
