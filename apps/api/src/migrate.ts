/** Production migration entry (bundled): `node apps/api/dist/migrate.js` with DATABASE_URL set. */
import { resolve } from 'node:path';
import { runMigrations } from '@hp/db/migrate';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
await runMigrations(url, process.env.MIGRATIONS_DIR ?? resolve(process.cwd(), 'packages/db/migrations'));
console.log('migrations applied');
process.exit(0);
