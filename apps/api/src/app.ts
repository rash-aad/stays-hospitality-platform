import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify, { type FastifyError } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors, jsonSchemaTransform, serializerCompiler, validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { randomUUID } from 'node:crypto';
import type { Config } from './config.js';
import { authenticate, setRootDomain } from './http/guards.js';
import { AppError } from './http/errors.js';
import { pingDb } from './infra/db.js';
import { httpDuration, registry } from './infra/metrics.js';
import { queueStats } from './infra/queue.js';
import { redis } from './infra/redis.js';
import { registerRoutes } from './routes.js';
import { setRuntimeConfig } from './runtime.js';

export async function buildApp(config: Config) {
  const app = Fastify({
    logger: config.NODE_ENV === 'test' ? false : {
      level: config.LOG_LEVEL,
      redact: ['req.headers.authorization', 'req.headers.cookie', 'body.password', 'body.secret'],
    },
    genReqId: (req) => (typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'].slice(0, 100) : randomUUID()),
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  setRootDomain(config.PLATFORM_ROOT_DOMAIN);
  setRuntimeConfig(config);

  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } });
  await app.register(cors, {
    origin: config.CORS_ORIGINS.split(',').map((s) => s.trim()),
    credentials: true,
    exposedHeaders: ['x-request-id'],
  });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
  await app.register(rateLimit, {
    global: true,
    max: config.NODE_ENV === 'test' ? 100_000 : 600,
    timeWindow: '1 minute',
    redis: redis(),
    nameSpace: 'rl:',
    keyGenerator: (req) => req.ip,
    allowList: config.NODE_ENV === 'test' ? () => true : undefined,
  });

  await app.register(swagger, {
    openapi: {
      info: { title: 'Hospitality Platform API', version: '1.0.0', description: 'Multi-tenant hospitality CRM, booking and guest-experience API.' },
      components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
      security: [{ bearer: [] }],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  app.decorateRequest('actor', null as never);
  app.decorateRequest('tenant', null);
  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-request-id', req.id);
    await authenticate(req);
  });
  app.addHook('onResponse', async (req, reply) => {
    httpDuration.observe({ method: req.method, route: req.routeOptions.url ?? 'unknown', status: String(reply.statusCode) }, reply.elapsedTime / 1000);
  });

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err)) {
      return reply.status(400).send({
        error: { code: 'validation_error', message: 'Request validation failed', details: err.validation.map((v) => ({ path: v.instancePath, message: v.message })), requestId: req.id },
      });
    }
    if (err instanceof AppError) {
      return reply.status(err.status).send({ error: { code: err.code, message: err.message, details: err.details, requestId: req.id } });
    }
    const pg = (err as { cause?: { code?: string; constraint_name?: string } }).cause ?? (err as { code?: string; constraint_name?: string });
    if (pg?.code === '23505') {
      return reply.status(409).send({ error: { code: 'duplicate', message: 'A record with these details already exists', details: { constraint: pg.constraint_name }, requestId: req.id } });
    }
    if (pg?.code === '23P01') {
      return reply.status(409).send({ error: { code: 'conflict', message: 'This conflicts with an existing reservation', details: { constraint: pg.constraint_name }, requestId: req.id } });
    }
    if (err.statusCode && err.statusCode < 500) {
      return reply.status(err.statusCode).send({ error: { code: err.code ?? 'error', message: err.message, requestId: req.id } });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({ error: { code: 'internal', message: 'Something went wrong', requestId: req.id } });
  });

  app.get('/live', { schema: { hide: true } }, async () => ({ status: 'ok' }));
  app.get('/health', { schema: { hide: true } }, async () => ({ status: 'ok', time: new Date().toISOString() }));
  app.get('/ready', { schema: { hide: true } }, async (_req, reply) => {
    const checks: Record<string, string> = {};
    try { await pingDb(); checks.db = 'ok'; } catch { checks.db = 'down'; }
    try { await redis().ping(); checks.redis = 'ok'; } catch { checks.redis = 'down'; }
    const ok = Object.values(checks).every((v) => v === 'ok');
    return reply.status(ok ? 200 : 503).send({ status: ok ? 'ready' : 'degraded', checks, queue: await queueStats().catch(() => null) });
  });
  app.get('/metrics', { schema: { hide: true } }, async (_req, reply) => {
    reply.header('content-type', registry.contentType);
    return registry.metrics();
  });

  await app.register(registerRoutes, { prefix: '/api/v1', config });
  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
