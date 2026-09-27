BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'import_runs'::regclass AND conname = 'import_runs_error_count_check') THEN
    ALTER TABLE import_runs DROP CONSTRAINT import_runs_error_count_check;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'import_runs'::regclass AND conname = 'import_runs_error_count_nonnegative') THEN
    ALTER TABLE import_runs ADD CONSTRAINT import_runs_error_count_nonnegative CHECK (error_count >= 0);
  END IF;
END $$;

ALTER TABLE import_runs
  ADD COLUMN IF NOT EXISTS warehouse_id bigint REFERENCES warehouses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS supplier_id bigint REFERENCES suppliers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rows_created bigint NOT NULL DEFAULT 0 CHECK (rows_created >= 0),
  ADD COLUMN IF NOT EXISTS rows_updated bigint NOT NULL DEFAULT 0 CHECK (rows_updated >= 0),
  ADD COLUMN IF NOT EXISTS rows_skipped bigint NOT NULL DEFAULT 0 CHECK (rows_skipped >= 0),
  ADD COLUMN IF NOT EXISTS rows_duplicate bigint NOT NULL DEFAULT 0 CHECK (rows_duplicate >= 0),
  ADD COLUMN IF NOT EXISTS duration_ms bigint CHECK (duration_ms IS NULL OR duration_ms >= 0),
  ADD COLUMN IF NOT EXISTS column_mapping jsonb,
  ADD COLUMN IF NOT EXISTS summary text;

ALTER TABLE import_errors
  ADD COLUMN IF NOT EXISTS raw_value text;

CREATE INDEX IF NOT EXISTS import_runs_warehouse_idx ON import_runs (warehouse_id, id DESC);
CREATE INDEX IF NOT EXISTS import_runs_status_idx ON import_runs (status, id DESC);
CREATE INDEX IF NOT EXISTS import_errors_run_row_idx ON import_errors (import_run_id, row_number);

CREATE TABLE IF NOT EXISTS warehouse_product_import_keys (
  warehouse_id bigint NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  brand_id bigint NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  normalized_article text NOT NULL,
  product_id bigint NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (warehouse_id, brand_id, normalized_article),
  UNIQUE (warehouse_id, product_id)
);

CREATE INDEX IF NOT EXISTS warehouse_product_import_keys_product_idx
  ON warehouse_product_import_keys (product_id, warehouse_id);

COMMIT;
