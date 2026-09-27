BEGIN;

CREATE INDEX IF NOT EXISTS products_article_trgm_idx
  ON products USING gin (article gin_trgm_ops);
CREATE INDEX IF NOT EXISTS products_brand_name_idx
  ON products (brand_id, normalized_article, id);
CREATE INDEX IF NOT EXISTS brands_name_trgm_idx
  ON brands USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS cross_numbers_article_trgm_idx
  ON cross_numbers USING gin (article gin_trgm_ops);
CREATE INDEX IF NOT EXISTS cross_numbers_brand_article_idx
  ON cross_numbers (brand_id, normalized_article, id);
CREATE INDEX IF NOT EXISTS product_cross_numbers_product_idx
  ON product_cross_numbers (product_id, cross_number_id);
CREATE INDEX IF NOT EXISTS vehicle_makes_name_trgm_idx
  ON vehicle_makes USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS vehicle_models_name_trgm_idx
  ON vehicle_models USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS vehicle_engines_name_trgm_idx
  ON vehicle_engines USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS vehicle_compatibility_product_model_idx
  ON vehicle_compatibility (product_id, model_id);

COMMIT;
