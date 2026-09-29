BEGIN;

-- Allow an import to be stopped without touching any product data. Replace
-- every status CHECK whose definition covers the durable-import statuses so
-- this remains safe when an earlier database used a generated constraint name.
DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT c.conname
      FROM pg_constraint c
     WHERE c.conrelid = 'import_runs'::regclass
       AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) LIKE '%status%'
       AND pg_get_constraintdef(c.oid) LIKE '%queued%'
       AND pg_get_constraintdef(c.oid) LIKE '%completed%'
  LOOP
    EXECUTE format('ALTER TABLE import_runs DROP CONSTRAINT %I', constraint_name);
  END LOOP;

  ALTER TABLE import_runs
    ADD CONSTRAINT import_runs_status_check
    CHECK (status IN (
      'queued',
      'preparing',
      'running',
      'completed',
      'completed_with_errors',
      'failed',
      'canceled'
    ));
END $$;

COMMIT;
