BEGIN;
CREATE TABLE IF NOT EXISTS product_admin_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id bigint REFERENCES products(id) ON DELETE SET NULL,
  action text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS product_admin_audit_product_idx ON product_admin_audit(product_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS product_admin_audit_action_idx ON product_admin_audit(action,created_at DESC,id DESC);
COMMIT;
