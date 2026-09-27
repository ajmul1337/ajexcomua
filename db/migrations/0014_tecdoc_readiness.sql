BEGIN;

-- TecDoc is an optional enrichment source. No TecDoc rows are inserted here;
-- existing records keep the manual source and nullable external identifiers.

ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS tecdoc_manufacturer_id text;

ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS tecdoc_part_id text;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS tecdoc_id text,
  ADD COLUMN IF NOT EXISTS tecdoc_manufacturer_id text,
  ADD COLUMN IF NOT EXISTS tecdoc_part_id text;

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS tecdoc_category_id text;

ALTER TABLE cross_numbers
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS tecdoc_part_id text;

ALTER TABLE cross_number_links
  ADD COLUMN IF NOT EXISTS tecdoc_link_id text;

ALTER TABLE product_cross_numbers
  ADD COLUMN IF NOT EXISTS tecdoc_link_id text;

ALTER TABLE product_attributes
  ADD COLUMN IF NOT EXISTS tecdoc_attribute_id text,
  ADD COLUMN IF NOT EXISTS attribute_group text;

ALTER TABLE vehicle_makes
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS tecdoc_id text;

ALTER TABLE vehicle_models
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS tecdoc_id text;

ALTER TABLE vehicle_generations
  ADD COLUMN IF NOT EXISTS tecdoc_id text;

ALTER TABLE vehicle_bodies
  ADD COLUMN IF NOT EXISTS tecdoc_id text;

ALTER TABLE vehicle_engines
  ADD COLUMN IF NOT EXISTS tecdoc_id text;

ALTER TABLE vehicle_fuels
  ADD COLUMN IF NOT EXISTS tecdoc_id text;

ALTER TABLE vehicle_modifications
  ADD COLUMN IF NOT EXISTS tecdoc_id text;

ALTER TABLE vehicle_compatibility
  ADD COLUMN IF NOT EXISTS tecdoc_id text,
  ADD COLUMN IF NOT EXISTS tecdoc_vehicle_id text;

CREATE UNIQUE INDEX IF NOT EXISTS brands_tecdoc_manufacturer_uidx
  ON brands (source, tecdoc_manufacturer_id)
  WHERE tecdoc_manufacturer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS articles_tecdoc_part_uidx
  ON articles (source, brand_id, tecdoc_part_id)
  WHERE tecdoc_part_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS products_tecdoc_uidx
  ON products (source, tecdoc_id)
  WHERE tecdoc_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS products_tecdoc_part_uidx
  ON products (source, tecdoc_manufacturer_id, tecdoc_part_id)
  WHERE tecdoc_manufacturer_id IS NOT NULL AND tecdoc_part_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS categories_tecdoc_uidx
  ON categories (source, tecdoc_category_id)
  WHERE tecdoc_category_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS cross_numbers_tecdoc_part_uidx
  ON cross_numbers (source, brand_id, tecdoc_part_id)
  WHERE tecdoc_part_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS cross_number_links_tecdoc_uidx
  ON cross_number_links (source, tecdoc_link_id)
  WHERE tecdoc_link_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS product_cross_numbers_tecdoc_idx
  ON product_cross_numbers (source, tecdoc_link_id, product_id)
  WHERE tecdoc_link_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS vehicle_makes_tecdoc_uidx
  ON vehicle_makes (source, tecdoc_id)
  WHERE tecdoc_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_models_tecdoc_uidx
  ON vehicle_models (source, tecdoc_id)
  WHERE tecdoc_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_generations_tecdoc_uidx
  ON vehicle_generations (source, tecdoc_id)
  WHERE tecdoc_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_bodies_tecdoc_uidx
  ON vehicle_bodies (source, tecdoc_id)
  WHERE tecdoc_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_engines_tecdoc_uidx
  ON vehicle_engines (source, tecdoc_id)
  WHERE tecdoc_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_fuels_tecdoc_uidx
  ON vehicle_fuels (source, tecdoc_id)
  WHERE tecdoc_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_modifications_tecdoc_uidx
  ON vehicle_modifications (source, tecdoc_id)
  WHERE tecdoc_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_compatibility_tecdoc_uidx
  ON vehicle_compatibility (source, tecdoc_id)
  WHERE tecdoc_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS vehicle_compatibility_tecdoc_vehicle_idx
  ON vehicle_compatibility (tecdoc_vehicle_id, product_id)
  WHERE tecdoc_vehicle_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS product_attributes_tecdoc_idx
  ON product_attributes (tecdoc_attribute_id, product_id)
  WHERE tecdoc_attribute_id IS NOT NULL;

-- Search paths used by catalog/autocomplete and vehicle filtering.
CREATE INDEX IF NOT EXISTS vehicle_makes_normalized_trgm_idx
  ON vehicle_makes USING gin (normalized_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS vehicle_models_normalized_trgm_idx
  ON vehicle_models USING gin (normalized_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS vehicle_engines_code_trgm_idx
  ON vehicle_engines USING gin (code gin_trgm_ops)
  WHERE code IS NOT NULL;

COMMIT;
