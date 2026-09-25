import { isModuleKey, PERMISSION_KEYS, PERMISSIONS, type Permission } from '@hp/contracts';
import { auditLogs, properties, rolePermissions, roles, tenants, userRoles, users } from '@hp/db';
import { and, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { badRequest, forbidden, notFound } from '../../http/errors.js';
import { requireStaff, staffActor, tenantOf } from '../../http/guards.js';
import type { Routes } from '../../http/types.js';
import { withTenant } from '../../infra/db.js';
import { audit } from '../../lib/audit.js';
import { offset, pageMeta, pageQuery } from '../../lib/pagination.js';
import { createOneTimeToken } from '../auth/service.js';
import { invalidateStaffAccess } from '../auth/permissions.js';
import { notify } from '../notifications/notify.js';
import { listModules, setModule } from '../tenants/modules.js';
import { invalidateTenant } from '../tenants/tenant-cache.js';

export const tenantAdminRoutes: Routes = async (app, { config }) => {
  app.addHook('preHandler', requireStaff());

  // ----- Workspace settings -----
  app.get('/admin/tenant', { schema: { tags: ['admin'] } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const [row] = await tx.select().from(tenants).where(eq(tenants.id, t.id));
      return { data: { ...row, modules: [...t.modules] } };
    });
  });

  app.patch('/admin/tenant', {
    preHandler: requireStaff('tenant.settings'),
    schema: { tags: ['admin'], body: z.object({ name: z.string().min(2).max(120).optional(), contactEmail: z.string().email().nullable().optional(), timezone: z.string().optional(), locale: z.string().optional() }) },
  }, async (req) => {
    const t = tenantOf(req);
    const row = await withTenant(t.id, async (tx) => {
      // Tenants table: tenant contexts can read their row; updates go through the owner connection policy.
      await tx.execute(sql`select set_config('app.bypass_rls', 'on', true)`);
      const [r] = await tx.update(tenants).set(req.body).where(eq(tenants.id, t.id)).returning();
      await audit(tx, req, { action: 'tenant.update', entityType: 'tenant', entityId: t.id, changes: req.body });
      return r;
    });
    await invalidateTenant(t.id);
    return { data: row };
  });

  // ----- Modules -----
  app.get('/admin/modules', { schema: { tags: ['admin'] } }, async (req) => {
    const t = tenantOf(req);
    return { data: await withTenant(t.id, (tx) => listModules(tx, t.id)) };
  });

  app.put('/admin/modules/:key', {
    preHandler: requireStaff('tenant.settings'),
    schema: { tags: ['admin'], params: z.object({ key: z.string() }), body: z.object({ enabled: z.boolean() }) },
  }, async (req) => {
    const t = tenantOf(req);
    if (!isModuleKey(req.params.key)) throw badRequest('Unknown module');
    const key = req.params.key;
    return withTenant(t.id, async (tx) => {
      const changed = await setModule(tx, t.id, key, req.body.enabled);
      await audit(tx, req, { action: req.body.enabled ? 'module.enable' : 'module.disable', entityType: 'module', entityId: key, changes: { changed } });
      return { data: await listModules(tx, t.id) };
    });
  });

  // ----- Staff -----
  app.get('/admin/staff', { preHandler: requireStaff('staff.manage'), schema: { tags: ['admin'], querystring: pageQuery } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const where = and(eq(users.tenantId, t.id), req.query.q ? or(ilike(users.name, `%${req.query.q}%`), ilike(users.email, `%${req.query.q}%`)) : undefined);
      const rows = await tx
        .select({
          id: users.id, name: users.name, email: users.email, status: users.status, lastLoginAt: users.lastLoginAt,
          roles: sql<{ id: string; key: string; name: string }[]>`coalesce((select json_agg(json_build_object('id', r.id, 'key', r.key, 'name', r.name)) from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = ${users.id}), '[]')`,
        })
        .from(users).where(where).orderBy(users.name).limit(req.query.pageSize).offset(offset(req.query));
      const [{ n }] = (await tx.select({ n: count() }).from(users).where(where)) as [{ n: number }];
      return { data: rows, meta: pageMeta(req.query, n) };
    });
  });

  app.post('/admin/staff', {
    preHandler: requireStaff('staff.manage'),
    schema: { tags: ['admin'], body: z.object({ name: z.string().min(2).max(120), email: z.string().email(), roleIds: z.array(z.string().uuid()).min(1) }) },
  }, async (req, reply) => {
    const t = tenantOf(req);
    const actor = staffActor(req);
    const user = await withTenant(t.id, async (tx) => {
      const rs = await tx.select().from(roles).where(and(eq(roles.tenantId, t.id), inArray(roles.id, req.body.roleIds)));
      if (rs.length !== req.body.roleIds.length) throw badRequest('Unknown role');
      if (rs.some((r) => r.key === 'owner') && !actor.isOwner) throw forbidden('Only owners can grant the Owner role');
      const [u] = await tx.insert(users).values({ tenantId: t.id, name: req.body.name, email: req.body.email, status: 'invited' }).returning();
      await tx.insert(userRoles).values(rs.map((r) => ({ tenantId: t.id, userId: u!.id, roleId: r.id })));
      const token = await createOneTimeToken(tx, { kind: 'staff_invite', tenantId: t.id, userId: u!.id, ttlMinutes: 7 * 24 * 60 });
      const [inviter] = await tx.select({ name: users.name }).from(users).where(eq(users.id, actor.userId));
      const [prop] = await tx.select({ name: properties.name }).from(properties).limit(1);
      await notify(tx, {
        tenantId: t.id, recipient: { type: 'user', id: u!.id }, templateKey: 'auth.staff_invite', channels: ['email'],
        vars: { name: req.body.name, inviter: inviter?.name ?? 'Your manager', property: prop?.name ?? t.name, link: `${config.WEB_PUBLIC_URL}/admin/accept-invite?token=${token}` },
      });
      await audit(tx, req, { action: 'staff.invite', entityType: 'user', entityId: u!.id, changes: { email: req.body.email, roles: rs.map((r) => r.key) } });
      return u!;
    });
    return reply.status(201).send({ data: { id: user.id, name: user.name, email: user.email, status: user.status } });
  });

  app.patch('/admin/staff/:id', {
    preHandler: requireStaff('staff.manage'),
    schema: { tags: ['admin'], params: z.object({ id: z.string().uuid() }), body: z.object({ name: z.string().min(2).optional(), status: z.enum(['active', 'disabled']).optional(), roleIds: z.array(z.string().uuid()).min(1).optional() }) },
  }, async (req) => {
    const t = tenantOf(req);
    const actor = staffActor(req);
    if (req.params.id === actor.userId && (req.body.status === 'disabled' || req.body.roleIds)) throw badRequest('You cannot change your own access');
    await withTenant(t.id, async (tx) => {
      const [u] = await tx.select().from(users).where(and(eq(users.id, req.params.id), eq(users.tenantId, t.id)));
      if (!u) throw notFound('Staff member');
      const currentRoles = await tx.select({ key: roles.key }).from(userRoles).innerJoin(roles, eq(roles.id, userRoles.roleId)).where(eq(userRoles.userId, u.id));
      if (currentRoles.some((r) => r.key === 'owner') && !actor.isOwner) throw forbidden('Only owners can change another owner');
      if (req.body.name || req.body.status) await tx.update(users).set({ name: req.body.name, status: req.body.status }).where(eq(users.id, u.id));
      if (req.body.roleIds) {
        const rs = await tx.select().from(roles).where(and(eq(roles.tenantId, t.id), inArray(roles.id, req.body.roleIds)));
        if (rs.length !== req.body.roleIds.length) throw badRequest('Unknown role');
        if (rs.some((r) => r.key === 'owner') && !actor.isOwner) throw forbidden('Only owners can grant the Owner role');
        await tx.delete(userRoles).where(eq(userRoles.userId, u.id));
        await tx.insert(userRoles).values(rs.map((r) => ({ tenantId: t.id, userId: u.id, roleId: r.id })));
      }
      await audit(tx, req, { action: 'staff.update', entityType: 'user', entityId: u.id, changes: req.body });
    });
    await invalidateStaffAccess(t.id, req.params.id);
    return { ok: true };
  });

  // ----- Roles -----
  app.get('/admin/roles', { preHandler: requireStaff('staff.manage'), schema: { tags: ['admin'] } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const rs = await tx.select().from(roles).where(eq(roles.tenantId, t.id)).orderBy(roles.name);
      const perms = await tx.select().from(rolePermissions).where(eq(rolePermissions.tenantId, t.id));
      return {
        data: rs.map((r) => ({ ...r, permissions: perms.filter((p) => p.roleId === r.id).map((p) => p.permissionKey) })),
        catalog: Object.entries(PERMISSIONS).map(([key, description]) => ({ key, description })),
      };
    });
  });

  const roleBody = z.object({ name: z.string().min(2).max(60), permissions: z.array(z.string()) });
  app.post('/admin/roles', { preHandler: requireStaff('staff.manage'), schema: { tags: ['admin'], body: roleBody } }, async (req, reply) => {
    const t = tenantOf(req);
    const perms = req.body.permissions.filter((p): p is Permission => (PERMISSION_KEYS as string[]).includes(p));
    const r = await withTenant(t.id, async (tx) => {
      const key = req.body.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') + '_' + Date.now().toString(36);
      const [r] = await tx.insert(roles).values({ tenantId: t.id, key, name: req.body.name }).returning();
      if (perms.length) await tx.insert(rolePermissions).values(perms.map((p) => ({ tenantId: t.id, roleId: r!.id, permissionKey: p })));
      await audit(tx, req, { action: 'role.create', entityType: 'role', entityId: r!.id, changes: { permissions: perms } });
      return r!;
    });
    return reply.status(201).send({ data: r });
  });

  app.put('/admin/roles/:id', { preHandler: requireStaff('staff.manage'), schema: { tags: ['admin'], params: z.object({ id: z.string().uuid() }), body: roleBody } }, async (req) => {
    const t = tenantOf(req);
    const perms = req.body.permissions.filter((p): p is Permission => (PERMISSION_KEYS as string[]).includes(p));
    await withTenant(t.id, async (tx) => {
      const [r] = await tx.select().from(roles).where(and(eq(roles.id, req.params.id), eq(roles.tenantId, t.id)));
      if (!r) throw notFound('Role');
      if (r.key === 'owner') throw badRequest('The Owner role always has every permission');
      await tx.update(roles).set({ name: req.body.name }).where(eq(roles.id, r.id));
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, r.id));
      if (perms.length) await tx.insert(rolePermissions).values(perms.map((p) => ({ tenantId: t.id, roleId: r.id, permissionKey: p })));
      await audit(tx, req, { action: 'role.update', entityType: 'role', entityId: r.id, changes: { permissions: perms } });
    });
    await invalidateStaffAccess(t.id);
    return { ok: true };
  });

  // ----- Staff directory (for assignment pickers; any staff) -----
  app.get('/admin/staff-directory', { schema: { tags: ['admin'] } }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => ({
      data: await tx
        .select({ id: users.id, name: users.name, roles: sql<string[]>`coalesce((select array_agg(r.key) from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = ${users.id}), '{}')` })
        .from(users).where(and(eq(users.tenantId, t.id), eq(users.status, 'active'))).orderBy(users.name),
    }));
  });

  // ----- Audit log -----
  app.get('/admin/audit', {
    preHandler: requireStaff('audit.read'),
    schema: { tags: ['admin'], querystring: pageQuery.extend({ action: z.string().optional(), entityType: z.string().optional() }) },
  }, async (req) => {
    const t = tenantOf(req);
    return withTenant(t.id, async (tx) => {
      const where = and(
        eq(auditLogs.tenantId, t.id),
        req.query.action ? ilike(auditLogs.action, `${req.query.action}%`) : undefined,
        req.query.entityType ? eq(auditLogs.entityType, req.query.entityType) : undefined,
      );
      const rows = await tx
        .select({ log: auditLogs, actorName: sql<string | null>`coalesce((select name from users where id = ${auditLogs.actorId}), (select first_name || ' ' || last_name from guests where id = ${auditLogs.actorId}))` })
        .from(auditLogs).where(where).orderBy(desc(auditLogs.createdAt)).limit(req.query.pageSize).offset(offset(req.query));
      const [{ n }] = (await tx.select({ n: count() }).from(auditLogs).where(where)) as [{ n: number }];
      return { data: rows.map((r) => ({ ...r.log, actorName: r.actorName })), meta: pageMeta(req.query, n) };
    });
  });
};
