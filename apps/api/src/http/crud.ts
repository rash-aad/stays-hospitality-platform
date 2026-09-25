import type { ModuleKey, Permission } from '@hp/contracts';
import { and, asc, eq, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z, type ZodObject, type ZodRawShape } from 'zod';
import { withTenant, type Tx } from '../infra/db.js';
import { audit } from '../lib/audit.js';
import { notFound } from './errors.js';
import { requireAnyModule, requireModule, requireStaff, tenantOf } from './guards.js';

type TenantTable = PgTable & { id: PgColumn; tenantId: PgColumn };

/**
 * Tenant-scoped CRUD for simple configuration tables. Tenant id is always injected from the
 * authenticated context and every read/write filters on it (RLS is the second line of defence).
 */
export function crud<T extends TenantTable, S extends ZodRawShape>(
  app: FastifyInstance,
  opts: {
    path: string;
    entity: string;
    table: T;
    body: ZodObject<S>;
    permission: Permission;
    readPermission?: Permission;
    modules?: ModuleKey[];
    /** Passes if any one of these modules is enabled. */
    anyModules?: ModuleKey[];
    orderBy?: PgColumn;
    filter?: (q: Record<string, string | undefined>) => SQL | undefined;
    validate?: (tx: Tx, tenantId: string, body: Record<string, unknown>) => Promise<void>;
    afterWrite?: (tx: Tx, tenantId: string, row: Record<string, unknown>) => Promise<void>;
    tag: string;
  },
) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const guard = (perm: Permission) => [
    requireStaff(perm),
    ...(opts.modules?.length ? [requireModule(...opts.modules)] : []),
    ...(opts.anyModules?.length ? [requireAnyModule(...opts.anyModules)] : []),
  ];
  const t = opts.table as TenantTable;
  const idParams = z.object({ id: z.string().uuid() });

  r.get(opts.path, { preHandler: guard(opts.readPermission ?? opts.permission), schema: { tags: [opts.tag], querystring: z.record(z.string(), z.string()).optional() } }, async (req) => {
    const tenant = tenantOf(req);
    return withTenant(tenant.id, async (tx) => ({
      data: await tx.select().from(t).where(and(eq(t.tenantId, tenant.id), opts.filter?.((req.query ?? {}) as Record<string, string>))).orderBy(asc(opts.orderBy ?? t.id)),
    }));
  });

  r.post(opts.path, { preHandler: guard(opts.permission), schema: { tags: [opts.tag], body: opts.body } }, async (req, reply) => {
    const tenant = tenantOf(req);
    const row = await withTenant(tenant.id, async (tx) => {
      const body = req.body as Record<string, unknown>;
      await opts.validate?.(tx, tenant.id, body);
      const [row] = (await tx.insert(t).values({ ...body, tenantId: tenant.id } as never).returning()) as Record<string, unknown>[];
      await opts.afterWrite?.(tx, tenant.id, row!);
      await audit(tx, req, { action: `${opts.entity}.create`, entityType: opts.entity, entityId: String(row!.id), changes: body });
      return row;
    });
    return reply.status(201).send({ data: row });
  });

  r.patch(`${opts.path}/:id`, { preHandler: guard(opts.permission), schema: { tags: [opts.tag], params: idParams, body: opts.body.partial() } }, async (req) => {
    const tenant = tenantOf(req);
    const { id } = req.params as { id: string };
    return withTenant(tenant.id, async (tx) => {
      const body = req.body as Record<string, unknown>;
      await opts.validate?.(tx, tenant.id, body);
      const [row] = (await tx.update(t).set(body as never).where(and(eq(t.id, id), eq(t.tenantId, tenant.id))).returning()) as Record<string, unknown>[];
      if (!row) throw notFound(opts.entity);
      await opts.afterWrite?.(tx, tenant.id, row);
      await audit(tx, req, { action: `${opts.entity}.update`, entityType: opts.entity, entityId: id, changes: body });
      return { data: row };
    });
  });

  r.delete(`${opts.path}/:id`, { preHandler: guard(opts.permission), schema: { tags: [opts.tag], params: idParams } }, async (req, reply) => {
    const tenant = tenantOf(req);
    const { id } = req.params as { id: string };
    await withTenant(tenant.id, async (tx) => {
      const [row] = (await tx.delete(t).where(and(eq(t.id, id), eq(t.tenantId, tenant.id))).returning()) as Record<string, unknown>[];
      if (!row) throw notFound(opts.entity);
      await opts.afterWrite?.(tx, tenant.id, row);
      await audit(tx, req, { action: `${opts.entity}.delete`, entityType: opts.entity, entityId: id });
    });
    return reply.status(204).send();
  });
}

export const imageRef = z.object({ url: z.string().url().max(1000), alt: z.string().max(200).default('') });
export const money = z.number().int().min(0).max(100_000_000_00);
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
export const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:00)?$/, 'HH:MM');
