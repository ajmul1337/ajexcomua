-- PostgreSQL catalog schema for a large automotive parts store.
-- Run once against the configured PostgreSQL database before enabling catalog reads.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION normalize_part_article(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT upper(regexp_replace(btrim(value), '[^[:alnum:]]', '', 'g'));
$$;

CREATE TABLE IF NOT EXISTS brands (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  normalized_name text GENERATED ALWAYS AS (upper(btrim(name))) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brands_name_not_empty CHECK (length(btrim(name)) > 0),
  CONSTRAINT brands_normalized_name_unique UNIQUE (normalized_name)
);

CREATE TABLE IF NOT EXISTS articles (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  brand_id bigint NOT NULL REFERENCES brands(id) ON DELETE RESTRICT,
  article text NOT NULL,
  normalized_article text GENERATED ALWAYS AS (normalize_part_article(article)) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT articles_article_not_empty CHECK (length(normalize_part_article(article)) > 0),
  CONSTRAINT articles_brand_article_unique UNIQUE (brand_id, normalized_article),
  CONSTRAINT articles_id_brand_normalized_unique UNIQUE (id, brand_id, normalized_article)
);

CREATE TABLE IF NOT EXISTS suppliers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  contact_name text,
  email text,
  phone text,
  external_code text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS warehouses (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  code text UNIQUE,
  address text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS categories (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  parent_id bigint REFERENCES categories(id) ON DELETE RESTRICT,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  brand_id bigint NOT NULL REFERENCES brands(id) ON DELETE RESTRICT,
  article_id bigint NOT NULL,
  article text NOT NULL,
  normalized_article text GENERATED ALWAYS AS (normalize_part_article(article)) STORED,
  name text NOT NULL,
  description text,
  category_id bigint REFERENCES categories(id) ON DELETE SET NULL,
  price numeric(14, 2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  stock bigint NOT NULL DEFAULT 0 CHECK (stock >= 0),
  warehouse_id bigint REFERENCES warehouses(id) ON DELETE SET NULL,
  supplier_id bigint REFERENCES suppliers(id) ON DELETE SET NULL,
  image text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'draft', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT products_article_not_empty CHECK (length(normalize_part_article(article)) > 0),
  CONSTRAINT products_brand_article_unique UNIQUE (brand_id, normalized_article),
  CONSTRAINT products_article_brand_fk FOREIGN KEY (article_id, brand_id, normalized_article)
    REFERENCES articles(id, brand_id, normalized_article) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS warehouse_products (
  warehouse_id bigint NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  product_id bigint NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  stock bigint NOT NULL DEFAULT 0 CHECK (stock >= 0),
  reserved_stock bigint NOT NULL DEFAULT 0 CHECK (reserved_stock >= 0 AND reserved_stock <= stock),
  purchase_price numeric(14, 2) CHECK (purchase_price IS NULL OR purchase_price >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (warehouse_id, product_id)
);

CREATE TABLE IF NOT EXISTS cross_numbers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  brand_id bigint REFERENCES brands(id) ON DELETE RESTRICT,
  article text NOT NULL,
  normalized_article text GENERATED ALWAYS AS (normalize_part_article(article)) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cross_numbers_article_not_empty CHECK (length(normalize_part_article(article)) > 0),
  CONSTRAINT cross_numbers_brand_article_unique UNIQUE NULLS NOT DISTINCT (brand_id, normalized_article)
);

CREATE TABLE IF NOT EXISTS product_cross_numbers (
  product_id bigint NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  cross_number_id bigint NOT NULL REFERENCES cross_numbers(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'manual',
  confidence numeric(5, 4) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, cross_number_id)
);

CREATE TABLE IF NOT EXISTS product_categories (
  product_id bigint NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  category_id bigint NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, category_id)
);

CREATE TABLE IF NOT EXISTS import_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  filename text NOT NULL,
  source text,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'completed_with_errors', 'failed')),
  rows_total bigint NOT NULL DEFAULT 0 CHECK (rows_total >= 0),
  rows_processed bigint NOT NULL DEFAULT 0 CHECK (rows_processed >= 0),
  error_count bigint NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS import_errors (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  import_run_id bigint NOT NULL REFERENCES import_runs(id) ON DELETE CASCADE,
  row_number bigint,
  code text NOT NULL,
  message text NOT NULL,
  raw_data jsonb,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS price_update_runs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  supplier_id bigint REFERENCES suppliers(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'completed_with_errors', 'failed')),
  rows_updated bigint NOT NULL DEFAULT 0 CHECK (rows_updated >= 0),
  error_count bigint NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Expandable vehicle directory; fitments can later be loaded from any licensed source.
CREATE TABLE IF NOT EXISTS vehicle_makes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  normalized_name text GENERATED ALWAYS AS (upper(btrim(name))) STORED UNIQUE
);

CREATE TABLE IF NOT EXISTS vehicle_models (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  make_id bigint NOT NULL REFERENCES vehicle_makes(id) ON DELETE CASCADE,
  name text NOT NULL,
  normalized_name text GENERATED ALWAYS AS (upper(btrim(name))) STORED,
  CONSTRAINT vehicle_models_make_name_unique UNIQUE (make_id, normalized_name)
);

CREATE TABLE IF NOT EXISTS vehicle_engines (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  model_id bigint NOT NULL REFERENCES vehicle_models(id) ON DELETE CASCADE,
  name text NOT NULL,
  fuel_type text,
  displacement_cc integer CHECK (displacement_cc IS NULL OR displacement_cc > 0),
  power_kw numeric(8, 2) CHECK (power_kw IS NULL OR power_kw > 0),
  code text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vehicle_compatibility (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id bigint NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  model_id bigint NOT NULL REFERENCES vehicle_models(id) ON DELETE CASCADE,
  engine_id bigint REFERENCES vehicle_engines(id) ON DELETE CASCADE,
  year_from smallint,
  year_to smallint,
  notes text,
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_compatibility_fitment_unique
    UNIQUE NULLS NOT DISTINCT (product_id, model_id, engine_id, year_from, year_to),
  CONSTRAINT vehicle_compatibility_year_range CHECK (
    year_from IS NULL OR year_to IS NULL OR year_from <= year_to
  )
);

-- Exact and prefix part-number lookups use B-tree indexes; no catalog scan is needed.
CREATE INDEX IF NOT EXISTS products_article_prefix_all_idx
  ON products (normalized_article text_pattern_ops);
CREATE INDEX IF NOT EXISTS products_article_sort_idx
  ON products (normalized_article, id);
CREATE INDEX IF NOT EXISTS products_brand_sort_all_idx ON products (brand_id, id);
CREATE INDEX IF NOT EXISTS products_category_sort_all_idx ON products (category_id, id);
CREATE INDEX IF NOT EXISTS products_supplier_sort_idx ON products (supplier_id, id);
CREATE INDEX IF NOT EXISTS products_warehouse_sort_idx ON products (warehouse_id, id);
CREATE INDEX IF NOT EXISTS products_price_sort_idx ON products (price, id);
CREATE INDEX IF NOT EXISTS products_updated_sort_idx ON products (updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS products_name_trgm_idx
  ON products USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS articles_normalized_lookup_idx
  ON articles (normalized_article, brand_id, id);
CREATE INDEX IF NOT EXISTS cross_numbers_normalized_lookup_idx
  ON cross_numbers (normalized_article, id);
CREATE INDEX IF NOT EXISTS cross_numbers_normalized_prefix_idx
  ON cross_numbers (normalized_article text_pattern_ops);
CREATE INDEX IF NOT EXISTS product_cross_numbers_cross_idx
  ON product_cross_numbers (cross_number_id, product_id);
CREATE INDEX IF NOT EXISTS product_categories_category_idx
  ON product_categories (category_id, product_id);
CREATE INDEX IF NOT EXISTS warehouse_products_product_idx
  ON warehouse_products (product_id, warehouse_id);
CREATE INDEX IF NOT EXISTS warehouse_products_available_idx
  ON warehouse_products (warehouse_id, stock, product_id) WHERE stock > 0;
CREATE INDEX IF NOT EXISTS vehicle_models_make_idx ON vehicle_models (make_id, id);
CREATE INDEX IF NOT EXISTS vehicle_engines_model_idx ON vehicle_engines (model_id, id);
CREATE INDEX IF NOT EXISTS vehicle_compatibility_model_idx
  ON vehicle_compatibility (model_id, year_from, year_to, product_id);
CREATE INDEX IF NOT EXISTS vehicle_compatibility_engine_idx
  ON vehicle_compatibility (engine_id, product_id) WHERE engine_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS import_runs_recent_idx ON import_runs (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS import_errors_open_idx ON import_errors (created_at DESC, id DESC) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS import_errors_run_idx ON import_errors (import_run_id, row_number);
CREATE INDEX IF NOT EXISTS price_update_runs_recent_idx ON price_update_runs (created_at DESC, id DESC);

COMMIT;
