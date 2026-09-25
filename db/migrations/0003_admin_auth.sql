CREATE TABLE IF NOT EXISTS ajex_admin_accounts (
  id smallint PRIMARY KEY CHECK (id = 1),
  username text NOT NULL CHECK (username = 'admin'),
  role text NOT NULL CHECK (role = 'admin'),
  password_salt text NOT NULL,
  password_hash text NOT NULL,
  password_iterations integer NOT NULL CHECK (password_iterations >= 100000),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ajex_admin_login_attempts (
  ip_hash text PRIMARY KEY,
  attempts integer NOT NULL CHECK (attempts >= 0),
  reset_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ajex_admin_login_attempts_reset_at_idx
  ON ajex_admin_login_attempts (reset_at);
