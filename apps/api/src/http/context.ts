import type { ModuleKey, Permission } from '@hp/contracts';

export type TenantInfo = {
  id: string;
  slug: string;
  name: string;
  status: 'active' | 'suspended';
  currency: string;
  timezone: string;
  modules: Set<ModuleKey>;
  /** Suspended by bookEZ billing: staff may sign in, but only to reach the Subscription page. */
  billingLocked: boolean;
};

export type Actor =
  | { type: 'anon' }
  | { type: 'platform'; userId: string; mfa?: 'ok' | 'pending' }
  | { type: 'staff'; userId: string; tenantId: string; permissions: Set<Permission>; isOwner: boolean; mfa?: 'ok' | 'pending' }
  | { type: 'guest'; guestId: string; tenantId: string };

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor;
    /** Tenant the request is scoped to — derived from the token or resolved host, never the body. */
    tenant: TenantInfo | null;
  }
}
