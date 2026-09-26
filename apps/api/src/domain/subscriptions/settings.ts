import { platformSettings } from '@hp/db';
import { eq } from 'drizzle-orm';
import type { Tx } from '../../infra/db.js';

export type PlatformBilling = {
  vpa: string | null; payeeName: string; legalName: string; gstin: string | null; address: string; stateCode: string | null;
  invoicePrefix: string; gstRateBps: number; sac: string; verifyPromise: string; graceDays: number; trialDays: number; email: string | null;
};
export const DEFAULT_PLATFORM_BILLING: PlatformBilling = {
  vpa: null, payeeName: 'bookEZ', legalName: 'bookEZ', gstin: null, address: '', stateCode: null, invoicePrefix: 'BKZ', gstRateBps: 1800,
  sac: '998315', verifyPromise: 'We confirm payments within 12 hours.', graceDays: 7, trialDays: 30, email: null,
};

export async function platformBilling(tx: Tx): Promise<PlatformBilling> {
  const [row] = await tx.select().from(platformSettings).where(eq(platformSettings.key, 'billing'));
  return { ...DEFAULT_PLATFORM_BILLING, ...((row?.value as Partial<PlatformBilling>) ?? {}) };
}

export async function savePlatformBilling(tx: Tx, value: PlatformBilling) {
  await tx.insert(platformSettings).values({ key: 'billing', value }).onConflictDoUpdate({ target: platformSettings.key, set: { value, updatedAt: new Date() } });
}
