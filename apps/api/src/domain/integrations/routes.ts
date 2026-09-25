import { integrations } from '@hp/db';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { notFound } from '../../http/errors.js';
import { requireModule, requireStaff, tenantOf } from '../../http/guards.js';
import type { Routes } from '../../http/types.js';
import { withTenant } from '../../infra/db.js';
import { audit } from '../../lib/audit.js';
import { encryptSecret } from '../../lib/crypto.js';

/** Catalogue of integration points. Credentials are encrypted at rest; only public config is returned. */
export const INTEGRATION_CATALOG = [
  { kind: 'channel_manager', provider: 'generic_ical', name: 'iCal availability sync', fields: ['feedUrl'] },
  { kind: 'channel_manager', provider: 'siteminder', name: 'SiteMinder', fields: ['propertyId', 'apiKey'] },
  { kind: 'pos', provider: 'petpooja', name: 'Petpooja POS', fields: ['restaurantId', 'apiKey'] },
  { kind: 'sms', provider: 'msg91', name: 'MSG91 SMS', fields: ['senderId', 'authKey'] },
  { kind: 'whatsapp', provider: 'gupshup', name: 'WhatsApp via Gupshup', fields: ['appName', 'apiKey'] },
  { kind: 'analytics', provider: 'ga4', name: 'Google Analytics 4', fields: ['measurementId'] },
  { kind: 'webhook', provider: 'outbound', name: 'Outbound webhooks', fields: ['url', 'secret'] },
] as const;
const SECRET_FIELDS = new Set(['apiKey', 'authKey', 'secret']);

export const integrationRoutes: Routes = async (app, { config }) => {
  const guard = [requireStaff('integrations.manage'), requireModule('integrations')];
  app.get('/admin/integrations', { preHandler: guard, schema: { tags: ['integrations'] } }, async (req) => {
    const t = tenantOf(req);
    const rows = await withTenant(t.id, (tx) => tx.select().from(integrations).where(eq(integrations.tenantId, t.id)));
    return { data: INTEGRATION_CATALOG.map((c) => { const r = rows.find((x) => x.kind === c.kind && x.provider === c.provider); return { ...c, connected: !!r, status: r?.status ?? null, publicConfig: r?.publicConfig ?? {}, hasSecrets: !!r?.configEnc, lastSyncAt: r?.lastSyncAt ?? null }; }) };
  });
  app.put('/admin/integrations/:kind/:provider', {
    preHandler: guard,
    schema: { tags: ['integrations'], params: z.object({ kind: z.string(), provider: z.string() }), body: z.object({ config: z.record(z.string(), z.string().max(500)), status: z.enum(['active', 'disabled']).default('active') }) },
  }, async (req) => {
    const t = tenantOf(req);
    const def = INTEGRATION_CATALOG.find((c) => c.kind === req.params.kind && c.provider === req.params.provider);
    if (!def) throw notFound('Integration');
    const pub: Record<string, string> = {};
    const secret: Record<string, string> = {};
    for (const f of def.fields) { const v = req.body.config[f]; if (v != null) (SECRET_FIELDS.has(f) ? secret : pub)[f] = v; }
    return withTenant(t.id, async (tx) => {
      const row = { tenantId: t.id, kind: def.kind, provider: def.provider, publicConfig: pub, status: req.body.status, ...(Object.keys(secret).length ? { configEnc: encryptSecret(JSON.stringify(secret), config.SECRETS_MASTER_KEY) } : {}) };
      await tx.insert(integrations).values(row).onConflictDoUpdate({ target: [integrations.tenantId, integrations.kind, integrations.provider], set: row });
      await audit(tx, req, { action: 'integration.update', entityType: 'integration', entityId: `${def.kind}:${def.provider}`, changes: { publicConfig: pub, secretsChanged: Object.keys(secret) } });
      return { ok: true };
    });
  });
  app.delete('/admin/integrations/:kind/:provider', { preHandler: guard, schema: { tags: ['integrations'], params: z.object({ kind: z.string(), provider: z.string() }) } }, async (req, reply) => {
    const t = tenantOf(req);
    await withTenant(t.id, (tx) => tx.delete(integrations).where(and(eq(integrations.tenantId, t.id), eq(integrations.kind, req.params.kind as 'pos'), eq(integrations.provider, req.params.provider))));
    return reply.status(204).send();
  });
};
