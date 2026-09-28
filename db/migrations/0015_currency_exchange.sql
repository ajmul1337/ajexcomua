BEGIN;

CREATE TABLE IF NOT EXISTS exchange_rates (
  currency text PRIMARY KEY,
  rate_to_uah numeric(18,6) NOT NULL CHECK (rate_to_uah > 0),
  source text NOT NULL DEFAULT 'manual' CHECK (source = 'manual'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);

INSERT INTO exchange_rates (currency, rate_to_uah, source)
VALUES ('UAH', 1.000000, 'manual'), ('USD', 43.500000, 'manual'), ('EUR', 51.000000, 'manual')
ON CONFLICT (currency) DO NOTHING;

ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS price_currency text NOT NULL DEFAULT 'UAH';
ALTER TABLE warehouses ALTER COLUMN price_currency SET DEFAULT 'UAH';
UPDATE warehouses SET price_currency = 'UAH' WHERE price_currency IS NULL;
ALTER TABLE warehouses ALTER COLUMN price_currency SET NOT NULL;
ALTER TABLE import_runs
  ADD COLUMN IF NOT EXISTS price_currency text,
  ADD COLUMN IF NOT EXISTS exchange_rate numeric(18,6),
  ADD COLUMN IF NOT EXISTS exchange_rate_source text;
ALTER TABLE product_offers
  ADD COLUMN IF NOT EXISTS supplier_price numeric(18,6),
  ADD COLUMN IF NOT EXISTS supplier_currency text,
  ADD COLUMN IF NOT EXISTS exchange_rate numeric(18,6);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='warehouses'::regclass AND conname='warehouses_price_currency_check') THEN
    ALTER TABLE warehouses ADD CONSTRAINT warehouses_price_currency_check CHECK (price_currency IS NULL OR price_currency IN ('UAH','USD','EUR'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='import_runs'::regclass AND conname='import_runs_price_currency_check') THEN
    ALTER TABLE import_runs ADD CONSTRAINT import_runs_price_currency_check CHECK (price_currency IS NULL OR price_currency IN ('UAH','USD','EUR'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='import_runs'::regclass AND conname='import_runs_exchange_rate_source_check') THEN
    ALTER TABLE import_runs ADD CONSTRAINT import_runs_exchange_rate_source_check CHECK (exchange_rate_source IS NULL OR exchange_rate_source='manual');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='product_offers'::regclass AND conname='product_offers_supplier_currency_check') THEN
    ALTER TABLE product_offers ADD CONSTRAINT product_offers_supplier_currency_check CHECK (supplier_currency IS NULL OR supplier_currency IN ('UAH','USD','EUR'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS exchange_rates_updated_idx ON exchange_rates (updated_at DESC);
CREATE INDEX IF NOT EXISTS product_offers_supplier_currency_idx ON product_offers (supplier_currency, updated_at DESC, product_id);

COMMIT;
