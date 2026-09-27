BEGIN;

ALTER TABLE warehouses
  ADD COLUMN IF NOT EXISTS auto_update_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS update_frequency text NOT NULL DEFAULT 'daily',
  ADD COLUMN IF NOT EXISTS update_time time NOT NULL DEFAULT '03:00',
  ADD COLUMN IF NOT EXISTS update_timezone text NOT NULL DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS next_update_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_last_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_last_error text,
  ADD COLUMN IF NOT EXISTS source_request_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS email_protocol text NOT NULL DEFAULT 'imap',
  ADD COLUMN IF NOT EXISTS email_folder text NOT NULL DEFAULT 'INBOX',
  ADD COLUMN IF NOT EXISTS email_from text,
  ADD COLUMN IF NOT EXISTS email_subject text,
  ADD COLUMN IF NOT EXISTS email_attachment_pattern text,
  ADD COLUMN IF NOT EXISTS email_allowed_extensions text[] NOT NULL DEFAULT ARRAY['csv','xlsx','xls'];

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='warehouses'::regclass AND conname='warehouses_update_frequency_check') THEN
    ALTER TABLE warehouses ADD CONSTRAINT warehouses_update_frequency_check
      CHECK (update_frequency IN ('hourly','daily','weekly'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='warehouses'::regclass AND conname='warehouses_email_protocol_check') THEN
    ALTER TABLE warehouses ADD CONSTRAINT warehouses_email_protocol_check
      CHECK (email_protocol IN ('imap'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS warehouse_source_jobs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  warehouse_id bigint NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  trigger text NOT NULL CHECK (trigger IN ('scheduled','manual')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','completed','failed')),
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  source_filename text,
  source_message_id text,
  import_run_id bigint REFERENCES import_runs(id) ON DELETE SET NULL,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS warehouse_source_jobs_due_idx
  ON warehouse_source_jobs (status, scheduled_for, id);
CREATE INDEX IF NOT EXISTS warehouse_source_jobs_warehouse_idx
  ON warehouse_source_jobs (warehouse_id, created_at DESC, id DESC);
CREATE UNIQUE INDEX IF NOT EXISTS warehouse_source_jobs_active_unique
  ON warehouse_source_jobs (warehouse_id) WHERE status IN ('queued','running');
CREATE INDEX IF NOT EXISTS warehouses_next_update_idx
  ON warehouses (next_update_at, id) WHERE auto_update_enabled = true;

COMMIT;
