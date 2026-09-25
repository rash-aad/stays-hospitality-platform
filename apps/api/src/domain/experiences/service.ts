import type { ModuleKey } from '@hp/contracts';
import { experienceBookings, experiences, experienceSlots, folioCharges, guests, taxes } from '@hp/db';
import { and, eq, sql } from 'drizzle-orm';
import type { TenantInfo } from '../../http/context.js';
import { badRequest, conflict, forbidden, moduleDisabled, notFound } from '../../http/errors.js';
import type { Tx } from '../../infra/db.js';
import { reference } from '../../lib/ids.js';
import { taxAmount, taxFor } from '../bookings/pricing.js';
import { requireInHouse, type StayContext } from '../guests/access.js';
import { notify } from '../notifications/notify.js';
import { enabledMethods, getSettings, startPayment, type Instructions } from '../payments/service.js';
import { registerPaymentTarget } from '../payments/targets.js';

type EB = typeof experienceBookings.$inferSelect;

/** Spa experiences are governed by the Spa module, transfers by Transport, the rest by Experiences. */
export function moduleForKind(kind: string): ModuleKey {
  return kind === 'spa' ? 'spa' : kind === 'transfer' ? 'transport' : 'experiences';
}

export async function bookExperience(
  tx: Tx,
  tenant: TenantInfo,
  ctx: StayContext,
  input: { slotId: string; participants: number; paymentMode: EB['paymentMode']; notes?: string | null },
): Promise<{ booking: EB; instructions: Instructions | null }> {
  if (!ctx.verified) throw forbidden('Please verify your email before booking');
  const [slot] = await tx.select().from(experienceSlots).where(and(eq(experienceSlots.id, input.slotId), eq(experienceSlots.tenantId, tenant.id))).for('update');
  if (!slot || slot.status !== 'open') throw notFound('Time slot');
  const [exp] = await tx.select().from(experiences).where(eq(experiences.id, slot.experienceId));
  if (!exp?.active || !exp.bookableByGuests) throw notFound('Experience');
  const mod = moduleForKind(exp.kind);
  if (!tenant.modules.has(mod)) throw moduleDisabled(mod);
  if (slot.startsAt.getTime() < Date.now() + 30 * 60_000) throw badRequest('This slot starts too soon to book online');
  if (input.participants < 1 || input.participants > exp.maxParticipants) throw badRequest(`Up to ${exp.maxParticipants} people per booking`);
  // Capacity guarded by the row lock and CHECK (booked <= capacity).
  const [updated] = await tx.update(experienceSlots).set({ booked: sql`${experienceSlots.booked} + ${input.participants}` })
    .where(and(eq(experienceSlots.id, slot.id), sql`${experienceSlots.booked} + ${input.participants} <= ${experienceSlots.capacity}`)).returning();
  if (!updated) throw conflict(`Only ${slot.capacity - slot.booked} places left in this slot`);

  const base = exp.pricePer === 'person' ? exp.price * input.participants : exp.price;
  const expTaxes = await tx.select().from(taxes).where(and(eq(taxes.tenantId, tenant.id), eq(taxes.active, true)));
  let tax = 0;
  let inclusive = 0;
  for (const t of taxFor(expTaxes, 'experience', base)) {
    const a = taxAmount(base, t.rateBps, t.inclusive);
    tax += a;
    if (t.inclusive) inclusive += a;
  }
  const total = base + tax - inclusive;
  let mode = input.paymentMode;
  if (total === 0) mode = 'free';
  else {
    const settings = await getSettings(tx, tenant.id);
    const allowed = enabledMethods(tenant, settings, 'experience', { inHouse: !!ctx.stay?.inHouse });
    if (!allowed.includes(mode as never)) throw badRequest('This payment option is not available', { allowed });
    if (!exp.requiresPayment && mode === 'pay_at_property') mode = 'pay_at_property';
  }
  const stay = mode === 'room_charge' ? requireInHouse(ctx) : ctx.stay;
  const online = mode === 'upi_manual' || mode === 'upi_gateway';
  const [eb] = await tx.insert(experienceBookings).values({
    tenantId: tenant.id, experienceId: exp.id, slotId: slot.id, guestId: ctx.guest.id, stayId: stay?.id ?? null, reference: reference('EX'), participants: input.participants,
    total, currency: tenant.currency, status: online ? 'pending_payment' : 'confirmed', paymentMode: mode,
    paymentStatus: mode === 'free' ? 'not_required' : mode === 'room_charge' ? 'charged_to_room' : online ? 'awaiting_payment' : 'unpaid', notes: input.notes?.slice(0, 500),
  }).returning();
  if (mode === 'room_charge') {
    await tx.insert(folioCharges).values({ tenantId: tenant.id, bookingId: stay!.bookingId, sourceType: 'experience_booking', sourceId: eb!.id, description: `${exp.name} × ${input.participants}`, amount: base - inclusive, taxAmount: tax - inclusive });
  }
  let instructions: Instructions | null = null;
  if (online) {
    const settings = await getSettings(tx, tenant.id);
    instructions = (await startPayment(tx, { tenant, settings, method: mode as 'upi_manual', targetType: 'experience_booking', targetId: eb!.id, bookingId: stay?.bookingId ?? null, guestId: ctx.guest.id, amount: total, description: `${exp.name} ${eb!.reference}` })).instructions;
  } else {
    await confirmNotice(tx, tenant.id, eb!, exp.name, slot.startsAt, tenant.timezone);
  }
  return { booking: eb!, instructions };
}

async function confirmNotice(tx: Tx, tenantId: string, eb: EB, name: string, startsAt: Date, tz: string) {
  const [g] = await tx.select().from(guests).where(eq(guests.id, eb.guestId));
  await notify(tx, { tenantId, recipient: { type: 'guest', id: eb.guestId }, templateKey: 'experience.confirmed', vars: { name: g?.firstName, experience: name, when: new Intl.DateTimeFormat('en-IN', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }).format(startsAt), participants: eb.participants, reference: eb.reference }, related: { type: 'experience_booking', id: eb.id } });
}

export async function cancelExperienceBooking(tx: Tx, tenant: TenantInfo, id: string, opts: { guestId?: string }) {
  const [eb] = await tx.select().from(experienceBookings).where(and(eq(experienceBookings.id, id), eq(experienceBookings.tenantId, tenant.id))).for('update');
  if (!eb || (opts.guestId && eb.guestId !== opts.guestId)) throw notFound('Booking');
  if (!['pending_payment', 'confirmed'].includes(eb.status)) throw conflict('This booking can no longer be cancelled');
  const [slot] = await tx.select().from(experienceSlots).where(eq(experienceSlots.id, eb.slotId)).for('update');
  if (opts.guestId && slot!.startsAt.getTime() - Date.now() < 12 * 3_600_000) throw conflict('Online cancellation closes 12 hours before the start — please contact the concierge');
  await tx.update(experienceSlots).set({ booked: sql`greatest(${experienceSlots.booked} - ${eb.participants}, 0)` }).where(eq(experienceSlots.id, eb.slotId));
  await tx.update(folioCharges).set({ voidedAt: new Date() }).where(and(eq(folioCharges.sourceType, 'experience_booking'), eq(folioCharges.sourceId, eb.id)));
  const [u] = await tx.update(experienceBookings).set({ status: 'cancelled' }).where(eq(experienceBookings.id, eb.id)).returning();
  return u!;
}

registerPaymentTarget('experience_booking', {
  async onCaptured(tx, p) {
    const [eb] = await tx.update(experienceBookings).set({ status: 'confirmed', paymentStatus: 'paid' }).where(eq(experienceBookings.id, p.targetId)).returning();
    if (!eb) return;
    const [exp] = await tx.select().from(experiences).where(eq(experiences.id, eb.experienceId));
    const [slot] = await tx.select().from(experienceSlots).where(eq(experienceSlots.id, eb.slotId));
    const { tenants } = await import('@hp/db');
    const [t] = await tx.select().from(tenants).where(eq(tenants.id, eb.tenantId));
    await confirmNotice(tx, eb.tenantId, eb, exp!.name, slot!.startsAt, t!.timezone);
  },
  async onSubmitted(tx, p) {
    await tx.update(experienceBookings).set({ paymentStatus: 'pending_verification' }).where(eq(experienceBookings.id, p.targetId));
  },
  async onRejected(tx, p) {
    await tx.update(experienceBookings).set({ paymentStatus: 'awaiting_payment' }).where(eq(experienceBookings.id, p.targetId));
  },
  async onRefunded(tx, p) {
    await tx.update(experienceBookings).set({ paymentStatus: 'refunded' }).where(eq(experienceBookings.id, p.targetId));
  },
});
