import type { ModuleKey, Permission } from '@hp/contracts';

export type TenantInfo = {
  id: string;
  slug: string;
  name: string;
  status: 'active' | 'suspended';
  currency: string;
  timezone: string;
  modules: Set<ModuleKey>;
};

export type Actor =
  | { type: 'anon' }
  | { type: 'platform'; userId: string }
  | { type: 'staff'; userId: string; tenantId: string; permissions: Set<Permission>; isOwner: boolean }
  | { type: 'guest'; guestId: string; tenantId: string };

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor;
    /** Tenant the request is scoped to — derived from the token or resolved host, never the body. */
    tenant: TenantInfo | null;
  }
}
