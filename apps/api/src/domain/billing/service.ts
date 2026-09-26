import { properties, tenants, type Supplier } from '@hp/db';
import { eq } from 'drizzle-orm';
import type { Tx } from '../../infra/db.js';
import { SAC, STATE_NAMES } from './gst.js';

export type BillingSettings = {
  legalName: string | null;
  gstin: string | null;
  address: string | null;
  invoicePrefix: string;
  sacRoom: string;
  sacFood: string;
  sacService: string;
  footerNote: string | null;
};

export const DEFAULT_BILLING: BillingSettings = {
  legalName: null, gstin: null, address: null, invoicePrefix: 'INV', sacRoom: SAC.room, sacFood: SAC.food, sacService: SAC.service, footerNote: null,
};

export async function getBilling(tx: Tx, tenantId: string): Promise<BillingSettings> {
  const [t] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
  return { ...DEFAULT_BILLING, ...((t?.settings?.billing as Partial<BillingSettings>) ?? {}) };
}

/** The supplier block printed on (and frozen into) a tax invoice. */
export async function supplierSnapshot(tx: Tx, tenantId: string): Promise<Supplier> {
  const b = await getBilling(tx, tenantId);
  const [t] = await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId));
  const [p] = await tx.select().from(properties).where(eq(properties.tenantId, tenantId)).limit(1);
  const stateCode = b.gstin ? b.gstin.slice(0, 2) : null;
  return {
    legalName: b.legalName ?? t?.name ?? '',
    tradeName: p?.name ?? t?.name ?? '',
    gstin: b.gstin,
    address: b.address ?? [p?.addressLine, p?.city, p?.region, p?.postalCode].filter(Boolean).join(', '),
    stateCode,
    stateName: stateCode ? (STATE_NAMES[stateCode] ?? null) : (p?.region ?? null),
    phone: p?.phone ?? null,
    email: p?.email ?? null,
  };
}
