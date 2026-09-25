import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  JWT_SECRET: z.string().min(32),
  SECRETS_MASTER_KEY: z.string().regex(/^[0-9a-f]{64}$/i, 'must be 32 bytes hex'),
  API_PORT: z.coerce.number().default(4000),
  API_PUBLIC_URL: z.string().default('http://localhost:4000'),
  WEB_PUBLIC_URL: z.string().default('http://localhost:3000'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().default(1025),
  MAIL_FROM: z.string().default('Stays <no-reply@stays.local>'),
  UPLOAD_DIR: z.string().default('./uploads'),
  PLATFORM_ROOT_DOMAIN: z.string().default('localhost'),
  LOG_LEVEL: z.string().default('info'),
  WEB_INTERNAL_URL: z.string().default('http://localhost:3000'),
  REVALIDATE_SECRET: z.string().optional(),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:ops@example.com'),
  /** Run BullMQ workers inside the API process (dev convenience). */
  INLINE_WORKER: z.enum(['0', '1']).default('1'),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  return parsed.data;
}
