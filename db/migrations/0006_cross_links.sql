BEGIN;

CREATE TABLE IF NOT EXISTS cross_number_links (
  left_cross_number_id bigint NOT NULL REFERENCES cross_numbers(id) ON DELETE CASCADE,
  right_cross_number_id bigint NOT NULL REFERENCES cross_numbers(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (left_cross_number_id, right_cross_number_id),
  CONSTRAINT cross_number_links_ordered CHECK (left_cross_number_id < right_cross_number_id)
);

CREATE INDEX IF NOT EXISTS cross_number_links_right_idx
  ON cross_number_links (right_cross_number_id, left_cross_number_id);
CREATE INDEX IF NOT EXISTS cross_number_links_source_idx
  ON cross_number_links (source, created_at DESC);
CREATE INDEX IF NOT EXISTS brands_normalized_prefix_idx
  ON brands (normalized_name text_pattern_ops);

CREATE TABLE IF NOT EXISTS cross_import_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  filename text NOT NULL,
  source text NOT NULL DEFAULT 'csv',
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','completed_with_errors','failed')),
  rows_total bigint NOT NULL DEFAULT 0 CHECK (rows_total >= 0),
  rows_processed bigint NOT NULL DEFAULT 0 CHECK (rows_processed >= 0),
  rows_created bigint NOT NULL DEFAULT 0 CHECK (rows_created >= 0),
  rows_duplicate bigint NOT NULL DEFAULT 0 CHECK (rows_duplicate >= 0),
  error_count bigint NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  summary text
);

CREATE TABLE IF NOT EXISTS cross_import_errors (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  import_run_id bigint NOT NULL REFERENCES cross_import_runs(id) ON DELETE CASCADE,
  row_number bigint NOT NULL,
  raw_value text,
  code text NOT NULL,
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cross_import_runs_recent_idx
  ON cross_import_runs (started_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS cross_import_errors_run_idx
  ON cross_import_errors (import_run_id, row_number, id);

COMMIT;
