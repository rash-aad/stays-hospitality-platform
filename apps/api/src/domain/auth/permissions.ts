import { PERMISSION_KEYS, type Permission } from '@hp/contracts';
import { rolePermissions, roles, userRoles, users } from '@hp/db';
import { and, eq } from 'drizzle-orm';
import { withTenant } from '../../infra/db.js';
import { redis } from '../../infra/redis.js';

export type StaffAccess = { active: boolean; isOwner: boolean; permissions: Permission[] };

export async function loadStaffAccess(tenantId: string, userId: string): Promise<StaffAccess> {
  const key = `perm:${tenantId}:${userId}`;
  const hit = await redis().get(key);
  if (hit) return JSON.parse(hit) as StaffAccess;
  const access = await withTenant(tenantId, async (tx) => {
    const [u] = await tx
      .select({ status: users.status })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.tenantId, tenantId)));
    if (!u || u.status !== 'active') return { active: false, isOwner: false, permissions: [] };
    const rows = await tx
      .select({ roleKey: roles.key, perm: rolePermissions.permissionKey })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .where(and(eq(userRoles.userId, userId), eq(userRoles.tenantId, tenantId)));
    const isOwner = rows.some((r) => r.roleKey === 'owner');
    const perms = isOwner ? PERMISSION_KEYS : [...new Set(rows.map((r) => r.perm).filter((p): p is Permission => !!p))];
    return { active: true, isOwner, permissions: perms };
  });
  await redis().set(key, JSON.stringify(access), 'EX', 60);
  return access;
}

export async function invalidateStaffAccess(tenantId: string, userId?: string) {
  if (userId) {
    await redis().del(`perm:${tenantId}:${userId}`);
    return;
  }
  const keys = await redis().keys(`perm:${tenantId}:*`);
  if (keys.length) await redis().del(...keys);
}
