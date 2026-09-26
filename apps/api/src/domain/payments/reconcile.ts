import { payments } from '@hp/db';
import { and, eq, gt, isNotNull, lt } from 'drizzle-orm';
import { asSystem, withTenant } from '../../infra/db.js';
import { GATEWAYS } from './gateways/index.js';
import { applyGatewayEvent, gatewayConfigured, gatewayCreds, getSettings } from './service.js';

/**
 * Safety net for missed webhooks: ask the gateway about every gateway payment still awaiting
 * confirmation (older than 2 minutes, younger than 2 days) and apply whatever it reports.
 */
export async function reconcileGatewayPayments(now = new Date()) {
  const pending = await asSystem((tx) =>
    tx.select({ id: payments.id, tenantId: payments.tenantId, provider: payments.provider, orderId: payments.providerOrderId })
      .from(payments)
      .where(and(eq(payments.method, 'upi_gateway'), eq(payments.status, 'awaiting_payment'), isNotNull(payments.providerOrderId),
        lt(payments.createdAt, new Date(now.getTime() - 2 * 60_000)), gt(payments.createdAt, new Date(now.getTime() - 2 * 86_400_000))))
      .limit(200),
  );
  let applied = 0;
  for (const p of pending) {
    try {
      await withTenant(p.tenantId, async (tx) => {
        const s = await getSettings(tx, p.tenantId);
        if (!gatewayConfigured(s) || !p.provider || s.gatewayProvider !== p.provider) return;
        const ev = await GATEWAYS[p.provider].fetchOrder(gatewayCreds(s), p.orderId!);
        if (ev && ev.status !== 'pending') { await applyGatewayEvent(tx, p.tenantId, ev); applied++; }
      });
    } catch (e) {
      console.warn(`reconcile ${p.id} failed: ${(e as Error).message}`);
    }
  }
  return { checked: pending.length, applied };
}
