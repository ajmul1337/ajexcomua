BEGIN;

CREATE TABLE IF NOT EXISTS vehicle_generations (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  model_id bigint NOT NULL REFERENCES vehicle_models(id) ON DELETE CASCADE,
  name text NOT NULL,
  normalized_name text GENERATED ALWAYS AS (upper(btrim(name))) STORED,
  year_from smallint,
  year_to smallint,
  external_id text,
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_generations_name_unique UNIQUE (model_id, normalized_name),
  CONSTRAINT vehicle_generations_year_range CHECK (year_from IS NULL OR year_to IS NULL OR year_from <= year_to)
);

CREATE TABLE IF NOT EXISTS vehicle_bodies (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  generation_id bigint NOT NULL REFERENCES vehicle_generations(id) ON DELETE CASCADE,
  name text NOT NULL,
  normalized_name text GENERATED ALWAYS AS (upper(btrim(name))) STORED,
  doors smallint CHECK (doors IS NULL OR doors BETWEEN 2 AND 8),
  external_id text,
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_bodies_name_unique UNIQUE (generation_id, normalized_name)
);

CREATE TABLE IF NOT EXISTS vehicle_fuels (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  normalized_name text GENERATED ALWAYS AS (upper(btrim(name))) STORED UNIQUE,
  external_id text,
  source text NOT NULL DEFAULT 'manual'
);

ALTER TABLE vehicle_engines
  ADD COLUMN IF NOT EXISTS fuel_id bigint REFERENCES vehicle_fuels(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';

CREATE TABLE IF NOT EXISTS vehicle_modifications (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  generation_id bigint NOT NULL REFERENCES vehicle_generations(id) ON DELETE CASCADE,
  body_id bigint REFERENCES vehicle_bodies(id) ON DELETE SET NULL,
  engine_id bigint REFERENCES vehicle_engines(id) ON DELETE SET NULL,
  fuel_id bigint REFERENCES vehicle_fuels(id) ON DELETE SET NULL,
  name text NOT NULL,
  normalized_name text GENERATED ALWAYS AS (upper(btrim(name))) STORED,
  year_from smallint,
  year_to smallint,
  external_id text,
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_modifications_name_unique UNIQUE (generation_id, normalized_name),
  CONSTRAINT vehicle_modifications_year_range CHECK (year_from IS NULL OR year_to IS NULL OR year_from <= year_to)
);

ALTER TABLE vehicle_compatibility
  ADD COLUMN IF NOT EXISTS generation_id bigint REFERENCES vehicle_generations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS body_id bigint REFERENCES vehicle_bodies(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS modification_id bigint REFERENCES vehicle_modifications(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';

CREATE INDEX IF NOT EXISTS vehicle_generations_model_idx ON vehicle_generations (model_id, year_from, id);
CREATE INDEX IF NOT EXISTS vehicle_bodies_generation_idx ON vehicle_bodies (generation_id, id);
CREATE INDEX IF NOT EXISTS vehicle_fuels_name_idx ON vehicle_fuels (normalized_name, id);
CREATE INDEX IF NOT EXISTS vehicle_engines_fuel_idx ON vehicle_engines (fuel_id, id);
CREATE INDEX IF NOT EXISTS vehicle_modifications_generation_idx ON vehicle_modifications (generation_id, year_from, id);
CREATE INDEX IF NOT EXISTS vehicle_modifications_body_idx ON vehicle_modifications (body_id, id);
CREATE INDEX IF NOT EXISTS vehicle_modifications_engine_idx ON vehicle_modifications (engine_id, id);
CREATE INDEX IF NOT EXISTS vehicle_compatibility_generation_idx ON vehicle_compatibility (generation_id, product_id);
CREATE INDEX IF NOT EXISTS vehicle_compatibility_body_idx ON vehicle_compatibility (body_id, product_id);
CREATE INDEX IF NOT EXISTS vehicle_compatibility_modification_idx ON vehicle_compatibility (modification_id, product_id);
CREATE INDEX IF NOT EXISTS vehicle_compatibility_product_fitment_idx ON vehicle_compatibility (product_id, generation_id, body_id, modification_id);

COMMIT;
