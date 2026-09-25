/** Idempotent cluster setup: test database and the unprivileged runtime role (RLS applies to it). */
import 'dotenv/config';
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
const appUrl = new URL(process.env.APP_DATABASE_URL!);
const role = appUrl.username;
const pass = decodeURIComponent(appUrl.password);
const [{ exists } = { exists: false }] = await sql<{ exists: boolean }[]>`select exists(select 1 from pg_roles where rolname = ${role}) as exists`;
if (!exists) await sql.unsafe(`CREATE ROLE ${role} LOGIN PASSWORD '${pass.replace(/'/g, "''")}'`);
const testDb = new URL(process.env.TEST_DATABASE_URL!).pathname.slice(1);
const [{ has } = { has: false }] = await sql<{ has: boolean }[]>`select exists(select 1 from pg_database where datname = ${testDb}) as has`;
if (!has) await sql.unsafe(`CREATE DATABASE ${testDb}`);
await sql.end();
console.log(`setup ok (role ${role}, test db ${testDb})`);
