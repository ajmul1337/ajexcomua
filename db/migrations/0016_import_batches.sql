BEGIN;

-- Import preparation and worker state. Existing import runs retain their
-- current state; new runs can additionally use the `preparing` state.
ALTER TABLE import_runs
  ADD COLUMN IF NOT EXISTS preparation_worker_id text,
  ADD COLUMN IF NOT EXISTS preparation_lease_until timestamptz,
  ADD COLUMN IF NOT EXISTS preparation_heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS preparation_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS prepared_through_row bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_batch_number bigint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS preparation_last_error text,
  ADD COLUMN IF NOT EXISTS preparation_finished_at timestamptz,
  ADD COLUMN IF NOT EXISTS current_batch_number bigint,
  ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz,
  ADD COLUMN IF NOT EXISTS worker_id text,
  ADD COLUMN IF NOT EXISTS lease_until timestamptz,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS processing_snapshot jsonb;

DO $$
DECLARE
  constraint_name text;
BEGIN
  -- The original status CHECK was declared inline in 0001 and is therefore
  -- normally named import_runs_status_check. Find it by definition as well
  -- so this remains safe if a database assigned a different generated name.
  FOR constraint_name IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'import_runs'::regclass
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) LIKE '%status%'
      AND pg_get_constraintdef(c.oid) LIKE '%completed_with_errors%'
  LOOP
    EXECUTE format('ALTER TABLE import_runs DROP CONSTRAINT %I', constraint_name);
  END LOOP;

  ALTER TABLE import_runs
    ADD CONSTRAINT import_runs_status_check
    CHECK (status IN ('queued', 'preparing', 'running', 'completed', 'completed_with_errors', 'failed'));
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'import_runs'::regclass
      AND conname = 'import_runs_preparation_attempts_check'
  ) THEN
    ALTER TABLE import_runs ADD CONSTRAINT import_runs_preparation_attempts_check
      CHECK (preparation_attempts >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'import_runs'::regclass
      AND conname = 'import_runs_prepared_through_row_check'
  ) THEN
    ALTER TABLE import_runs ADD CONSTRAINT import_runs_prepared_through_row_check
      CHECK (prepared_through_row >= 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'import_runs'::regclass
      AND conname = 'import_runs_next_batch_number_check'
  ) THEN
    ALTER TABLE import_runs ADD CONSTRAINT import_runs_next_batch_number_check
      CHECK (next_batch_number > 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'import_runs'::regclass
      AND conname = 'import_runs_attempt_count_check'
  ) THEN
    ALTER TABLE import_runs ADD CONSTRAINT import_runs_attempt_count_check
      CHECK (attempt_count >= 0);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS import_run_batches (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  import_run_id bigint NOT NULL REFERENCES import_runs(id) ON DELETE CASCADE,
  batch_number bigint NOT NULL,
  row_start bigint NOT NULL,
  row_end bigint NOT NULL,
  row_count bigint NOT NULL,
  chunk_path text NOT NULL,
  chunk_hash text NOT NULL,
  source_cursor_start jsonb,
  source_cursor_end jsonb,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  worker_id text,
  lease_until timestamptz,
  heartbeat_at timestamptz,
  next_attempt_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  rows_processed bigint NOT NULL DEFAULT 0,
  rows_created bigint NOT NULL DEFAULT 0,
  rows_updated bigint NOT NULL DEFAULT 0,
  rows_skipped bigint NOT NULL DEFAULT 0,
  rows_duplicate bigint NOT NULL DEFAULT 0,
  error_count bigint NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT import_run_batches_range_check
    CHECK (
      row_start > 0
      AND row_end >= row_start
      AND row_count = row_end - row_start + 1
    ),
  CONSTRAINT import_run_batches_attempts_check CHECK (attempts >= 0),
  CONSTRAINT import_run_batches_rows_processed_check CHECK (rows_processed >= 0),
  CONSTRAINT import_run_batches_rows_created_check CHECK (rows_created >= 0),
  CONSTRAINT import_run_batches_rows_updated_check CHECK (rows_updated >= 0),
  CONSTRAINT import_run_batches_rows_skipped_check CHECK (rows_skipped >= 0),
  CONSTRAINT import_run_batches_rows_duplicate_check CHECK (rows_duplicate >= 0),
  CONSTRAINT import_run_batches_error_count_check CHECK (error_count >= 0),
  CONSTRAINT import_run_batches_unique_number UNIQUE (import_run_id, batch_number),
  CONSTRAINT import_run_batches_unique_chunk UNIQUE (import_run_id, chunk_path)
);

CREATE INDEX IF NOT EXISTS import_run_batches_queue_idx
  ON import_run_batches (status, next_attempt_at, lease_until, import_run_id, batch_number);
CREATE INDEX IF NOT EXISTS import_run_batches_run_idx
  ON import_run_batches (import_run_id, batch_number);

COMMIT;
