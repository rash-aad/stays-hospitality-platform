import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

export default async function setup() {
  config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });
  const url = process.env.TEST_DATABASE_URL!;
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await sql.unsafe('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE; GRANT ALL ON SCHEMA public TO public;');
  await sql.end();
  const { runMigrations } = await import('@hp/db/migrate');
  await runMigrations(url);
}
