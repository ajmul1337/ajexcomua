BEGIN;

ALTER TABLE import_runs
  ADD COLUMN IF NOT EXISTS safety_warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS safety_confirmed_at timestamptz;

ALTER TABLE warehouse_product_import_keys
  ADD COLUMN IF NOT EXISTS last_import_run_id bigint REFERENCES import_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS warehouse_import_keys_last_run_idx
  ON warehouse_product_import_keys (warehouse_id, last_import_run_id);

CREATE TABLE IF NOT EXISTS import_admin_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  import_run_id bigint REFERENCES import_runs(id) ON DELETE SET NULL,
  action text NOT NULL,
  username text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS import_admin_audit_run_idx
  ON import_admin_audit (import_run_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS import_admin_audit_action_idx
  ON import_admin_audit (action, created_at DESC, id DESC);

COMMIT;
