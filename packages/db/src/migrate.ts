import 'dotenv/config';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { fileURLToPath } from 'node:url';
import { createDb } from './client.js';

const POST_MIGRATE = `
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
    WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r.table_name);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = r.table_name AND policyname = 'tenant_isolation') THEN
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I USING (app_bypass_rls() OR tenant_id = app_current_tenant()) WITH CHECK (app_bypass_rls() OR tenant_id = app_current_tenant())',
        r.table_name);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hp_app') THEN
    GRANT USAGE ON SCHEMA public TO hp_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO hp_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO hp_app;
  END IF;
END $$;`;

export async function runMigrations(url: string, migrationsFolder = fileURLToPath(new URL('../migrations', import.meta.url))) {
  const { db, sql } = createDb(url, { max: 1 });
  await migrate(db, { migrationsFolder });
  // Re-assert RLS + grants for every tenant table so new tables added by later migrations are covered.
  await sql.unsafe(POST_MIGRATE);
  await sql.end();
}
