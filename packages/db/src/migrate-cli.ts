import 'dotenv/config';
import { runMigrations } from './migrate.js';

await runMigrations(process.env.MIGRATE_URL ?? process.env.DATABASE_URL!);
console.log('migrations applied');
