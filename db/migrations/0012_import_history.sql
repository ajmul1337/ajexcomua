BEGIN;

ALTER TABLE import_runs
  ADD COLUMN IF NOT EXISTS started_by text,
  ADD COLUMN IF NOT EXISTS source_file_path text,
  ADD COLUMN IF NOT EXISTS source_metadata jsonb,
  ADD COLUMN IF NOT EXISTS retry_of_run_id bigint REFERENCES import_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS import_runs_history_idx
  ON import_runs (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS import_runs_warehouse_history_idx
  ON import_runs (warehouse_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS import_runs_supplier_history_idx
  ON import_runs (supplier_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS import_runs_started_by_idx
  ON import_runs (started_by, created_at DESC, id DESC);

COMMIT;
