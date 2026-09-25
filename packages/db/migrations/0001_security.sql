-- Extensions
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
-- A table can hold only one active reservation at any instant.
ALTER TABLE restaurant_reservations ADD CONSTRAINT restaurant_reservations_no_overlap
  EXCLUDE USING gist (table_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
  WHERE (table_id IS NOT NULL AND status IN ('confirmed', 'seated'));
--> statement-breakpoint
-- Row-level security: every table carrying tenant_id is isolated by the per-transaction
-- setting app.tenant_id. Platform/system operations set app.bypass_rls = 'on' explicitly.
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_bypass_rls() RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT coalesce(current_setting('app.bypass_rls', true), '') = 'on' $$;
--> statement-breakpoint
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
    WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r.table_name);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', r.table_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (app_bypass_rls() OR tenant_id = app_current_tenant()) WITH CHECK (app_bypass_rls() OR tenant_id = app_current_tenant())',
      r.table_name);
  END LOOP;
END $$;
--> statement-breakpoint
-- The tenants table itself: a tenant context may only see its own row.
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_self ON tenants USING (app_bypass_rls() OR id = app_current_tenant())
  WITH CHECK (app_bypass_rls());
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hp_app') THEN
    GRANT USAGE ON SCHEMA public TO hp_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO hp_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO hp_app;
  END IF;
END $$;
