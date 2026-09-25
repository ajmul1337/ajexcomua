BEGIN;

ALTER TABLE warehouses
  ADD COLUMN IF NOT EXISTS supplier_id bigint REFERENCES suppliers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'manual_upload',
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS api_url text,
  ADD COLUMN IF NOT EXISTS price_format text NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS source_credentials_ciphertext text,
  ADD COLUMN IF NOT EXISTS source_credentials_iv text,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS import_settings jsonb NOT NULL DEFAULT '{"delimiter":"auto","encoding":"utf-8","firstRowHeaders":true,"columnMapping":{}}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_import_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_import_status text NOT NULL DEFAULT 'never';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'warehouses'::regclass AND conname = 'warehouses_source_type_check') THEN
    ALTER TABLE warehouses ADD CONSTRAINT warehouses_source_type_check
      CHECK (source_type IN ('api', 'email', 'manual_upload'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'warehouses'::regclass AND conname = 'warehouses_price_format_check') THEN
    ALTER TABLE warehouses ADD CONSTRAINT warehouses_price_format_check
      CHECK (price_format IN ('auto', 'csv', 'xlsx', 'xls', 'xml', 'json', 'custom'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'warehouses'::regclass AND conname = 'warehouses_last_import_status_check') THEN
    ALTER TABLE warehouses ADD CONSTRAINT warehouses_last_import_status_check
      CHECK (last_import_status IN ('never', 'queued', 'running', 'success', 'success_with_errors', 'failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS warehouses_supplier_idx ON warehouses (supplier_id, id);
CREATE INDEX IF NOT EXISTS warehouses_active_source_idx ON warehouses (source_type, id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS warehouses_last_import_idx ON warehouses (last_import_at DESC, id DESC);

COMMIT;
