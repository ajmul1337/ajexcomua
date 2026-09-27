BEGIN;

CREATE TABLE IF NOT EXISTS product_offers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id bigint NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id bigint NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  supplier_id bigint REFERENCES suppliers(id) ON DELETE SET NULL,
  price numeric(14,2) NOT NULL DEFAULT 0 CHECK (price >= 0),
  stock bigint NOT NULL DEFAULT 0 CHECK (stock >= 0),
  lead_time_days integer CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
  supplier_article text,
  normalized_supplier_article text GENERATED ALWAYS AS (NULLIF(normalize_part_article(coalesce(supplier_article, '')), '')) STORED,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','out_of_stock','paused','archived')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  offer_key bigint GENERATED ALWAYS AS (coalesce(supplier_id, 0)) STORED,
  CONSTRAINT product_offers_supplier_article_not_empty CHECK (supplier_article IS NULL OR length(normalize_part_article(supplier_article)) > 0),
  CONSTRAINT product_offers_offer_key_unique UNIQUE (product_id, warehouse_id, offer_key)
);

CREATE INDEX IF NOT EXISTS product_offers_product_best_idx
  ON product_offers (product_id, status, stock DESC, price ASC, updated_at DESC);
CREATE INDEX IF NOT EXISTS product_offers_warehouse_idx
  ON product_offers (warehouse_id, updated_at DESC, product_id);
CREATE INDEX IF NOT EXISTS product_offers_supplier_idx
  ON product_offers (supplier_id, updated_at DESC, product_id);
CREATE INDEX IF NOT EXISTS product_offers_supplier_article_idx
  ON product_offers (normalized_supplier_article, product_id);

INSERT INTO product_offers (product_id, warehouse_id, supplier_id, price, stock, supplier_article, status, updated_at)
SELECT wp.product_id, wp.warehouse_id, w.supplier_id, COALESCE(wp.purchase_price, p.price), wp.stock, p.article,
       CASE WHEN wp.stock > 0 THEN 'active' ELSE 'out_of_stock' END, wp.updated_at
FROM warehouse_products wp
JOIN products p ON p.id = wp.product_id
JOIN warehouses w ON w.id = wp.warehouse_id
ON CONFLICT (product_id, warehouse_id, offer_key) DO UPDATE SET
  price = EXCLUDED.price, stock = EXCLUDED.stock, supplier_article = EXCLUDED.supplier_article,
  status = EXCLUDED.status, updated_at = EXCLUDED.updated_at;

COMMIT;
