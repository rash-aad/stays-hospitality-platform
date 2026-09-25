import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });
process.env.NODE_ENV = 'test';
process.env.APP_DATABASE_URL = process.env.TEST_APP_DATABASE_URL;
process.env.INLINE_WORKER = '0';
