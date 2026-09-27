BEGIN;

CREATE TABLE IF NOT EXISTS product_attributes (
  product_id bigint NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  attribute_key text NOT NULL,
  attribute_value text NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, attribute_key),
  CONSTRAINT product_attributes_key_not_empty CHECK (length(btrim(attribute_key)) > 0)
);

CREATE INDEX IF NOT EXISTS product_attributes_key_value_idx
  ON product_attributes (attribute_key, attribute_value, product_id);
CREATE INDEX IF NOT EXISTS product_attributes_product_idx
  ON product_attributes (product_id, attribute_key);

COMMIT;
