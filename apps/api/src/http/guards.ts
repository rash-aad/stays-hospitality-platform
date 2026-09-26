import type { ModuleKey, Permission } from '@hp/contracts';
import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { loadStaffAccess } from '../domain/auth/permissions.js';
import { verifyAccess } from '../domain/auth/tokens.js';
import { loadTenant, resolveHost, resolveSlug } from '../domain/tenants/tenant-cache.js';
import type { Actor, TenantInfo } from './context.js';
import { AppError, forbidden, moduleDisabled, notFound, unauthorized } from './errors.js';
import { platformIpAllowed } from '../lib/ip-allow.js';
import { runtimeConfig } from '../runtime.js';

/** Populates req.actor from the bearer token. Never trusts tenant ids from body/query. */
export async function authenticate(req: FastifyRequest): Promise<void> {
  req.actor = { type: 'anon' };
  req.tenant = null;
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return;
  const claims = await verifyAccess(header.slice(7));
  if (!claims) return;
  // Until the second factor is set up / presented, a session can only reach the auth endpoints.
  if (claims.typ !== 'guest' && claims.mfa === 'pending' && !req.url.startsWith('/api/v1/auth/')) {
    throw new AppError(403, 'mfa_required', 'Set up two-step sign-in to continue');
  }
  if (claims.typ === 'platform') {
    req.actor = { type: 'platform', userId: claims.sub, mfa: claims.mfa };
    return;
  }
  const tenant = await loadTenant(claims.tid);
  if (!tenant || tenant.status !== 'active') return;
  // A token minted for one property is never honoured on another property's site.
  const siteHost = req.headers['x-tenant-host'];
  if (typeof siteHost === 'string' && siteHost) {
    const hostTenant = await resolveHost(siteHost, rootDomain);
    if (hostTenant && hostTenant !== tenant.id) return;
  }
  if (claims.typ === 'staff') {
    const access = await loadStaffAccess(tenant.id, claims.sub);
    if (!access.active) return;
    req.actor = {
      type: 'staff', userId: claims.sub, tenantId: tenant.id, isOwner: access.isOwner,
      permissions: new Set(access.permissions), mfa: claims.mfa,
    };
  } else {
    req.actor = { type: 'guest', guestId: claims.sub, tenantId: tenant.id };
  }
  req.tenant = tenant;
}

export function requireStaff(...perms: Permission[]): preHandlerAsyncHookHandler {
  return async (req) => {
    if (req.actor.type !== 'staff') throw unauthorized();
    for (const p of perms) if (!req.actor.permissions.has(p)) throw forbidden(`Missing permission: ${p}`);
  };
}

export const requireGuest: preHandlerAsyncHookHandler = async (req) => {
  if (req.actor.type !== 'guest') throw unauthorized('Guest sign-in required');
};

export const requirePlatform: preHandlerAsyncHookHandler = async (req) => {
  if (req.actor.type !== 'platform') throw unauthorized('Platform administrator sign-in required');
  if (!platformIpAllowed(req.ip, runtimeConfig().PLATFORM_IP_ALLOWLIST)) throw new AppError(403, 'ip_not_allowed', 'The platform console can’t be used from this network');
};

/** Rejects the request unless every listed module is effective for the request's tenant. */
export function requireModule(...keys: ModuleKey[]): preHandlerAsyncHookHandler {
  return async (req) => {
    if (!req.tenant) throw unauthorized();
    for (const k of keys) if (!req.tenant.modules.has(k)) throw moduleDisabled(k);
  };
}

/** Any of the listed modules suffices (e.g. a request type gated by one of several modules). */
export function requireAnyModule(...keys: ModuleKey[]): preHandlerAsyncHookHandler {
  return async (req) => {
    if (!req.tenant) throw unauthorized();
    if (!keys.some((k) => req.tenant!.modules.has(k))) throw moduleDisabled(keys.join(' | '));
  };
}

let rootDomain = 'localhost';
export function setRootDomain(d: string) {
  rootDomain = d;
}

/**
 * Public (unauthenticated) tenant scope, resolved from the site hostname. The web app forwards the
 * visitor's Host as X-Tenant-Host; `?site=<slug>` is accepted for previews. Public scope only ever
 * exposes published/public data.
 */
export const resolvePublicTenant: preHandlerAsyncHookHandler = async (req) => {
  if (req.tenant) return; // authenticated guest already carries a tenant
  const hostHeader = req.headers['x-tenant-host'];
  const slug = (req.query as Record<string, unknown> | undefined)?.site;
  let tenantId: string | null = null;
  if (typeof hostHeader === 'string' && hostHeader) tenantId = await resolveHost(hostHeader, rootDomain);
  if (!tenantId && typeof slug === 'string' && slug) tenantId = await resolveSlug(slug);
  if (!tenantId) throw notFound('Property');
  const tenant = await loadTenant(tenantId);
  if (!tenant || tenant.status !== 'active') throw notFound('Property');
  req.tenant = tenant;
};

export function staffActor(req: FastifyRequest) {
  if (req.actor.type !== 'staff') throw unauthorized();
  return req.actor;
}
export function guestActor(req: FastifyRequest) {
  if (req.actor.type !== 'guest') throw unauthorized();
  return req.actor;
}
export function tenantOf(req: FastifyRequest): TenantInfo {
  if (!req.tenant) throw unauthorized();
  return req.tenant;
}
export type { Actor, FastifyReply };
