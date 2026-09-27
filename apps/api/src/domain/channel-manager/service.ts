import { availability, bookings, channelAriState, channelConnections, channelMappings, channelSyncLog, ratePlans, rateSeasons, rooms } from '@hp/db';
import { and, eq, gte, lt, sql } from 'drizzle-orm';
import type { TenantInfo } from '../../http/context.js';
import { asSystem, withTenant, type Tx } from '../../infra/db.js';
import { decryptSecret } from '../../lib/crypto.js';
import { addDays, todayIn } from '../../lib/dates.js';
import { runtimeConfig } from '../../runtime.js';
import { eachNight, nightlyBase } from '../bookings/pricing.js';
import { cancelBooking, createBooking, modifyBooking } from '../bookings/service.js';
import { nightPricer } from '../revenue/rules.js';
import { loadTenant } from '../tenants/tenant-cache.js';
import { ADAPTERS, type AvailabilityUpdate, type Conn, type ExternalBooking, type RestrictionUpdate } from './adapters.js';

type Connection = typeof channelConnections.$inferSelect;

export const connFor = (c: Connection): Conn => ({ id: c.id, externalPropertyId: c.externalPropertyId, environment: c.environment, apiKey: c.apiKeyEnc ? decryptSecret(c.apiKeyEnc, runtimeConfig().SECRETS_MASTER_KEY) : null });

async function log(tenantId: string, connectionId: string, direction: 'push' | 'pull' | 'test', ok: boolean, summary: string) {
  await withTenant(tenantId, (tx) => tx.insert(channelSyncLog).values({ tenantId, connectionId, direction, ok, summary: summary.slice(0, 500) }));
}

/** What the channel should show right now: rooms left per room type; rate, stop-sell and minimum stay per rate plan. */
export async function currentAri(tx: Tx, tenant: TenantInfo, c: Connection) {
  const from = todayIn(tenant.timezone);
  const to = addDays(from, c.horizonDays);
  const dates = eachNight(from, to);
  const maps = await tx.select().from(channelMappings).where(eq(channelMappings.connectionId, c.id));
  const values = new Map<string, Map<string, string>>(); // key → date → value
  const put = (key: string, date: string, v: string) => { if (!values.has(key)) values.set(key, new Map()); values.get(key)!.set(date, v); };
  const doneTypes = new Set<string>();
  for (const m of maps) {
    const ledger = await tx.select().from(availability).where(and(eq(availability.roomTypeId, m.roomTypeId), gte(availability.date, from), lt(availability.date, to)));
    const byDate = new Map(ledger.map((l) => [l.date, l]));
    const [{ sellable }] = (await tx.select({ sellable: sql<number>`count(*)::int` }).from(rooms).where(and(eq(rooms.roomTypeId, m.roomTypeId), eq(rooms.status, 'active')))) as [{ sellable: number }];
    if (!doneTypes.has(m.externalRoomTypeId)) {
      doneTypes.add(m.externalRoomTypeId);
      for (const d of dates) { const l = byDate.get(d); put(`av:${m.externalRoomTypeId}`, d, String(l ? Math.max(0, l.total - l.booked) : sellable)); }
    }
    const [plan] = await tx.select().from(ratePlans).where(eq(ratePlans.id, m.ratePlanId));
    if (!plan) continue;
    const seasons = await tx.select().from(rateSeasons).where(eq(rateSeasons.ratePlanId, plan.id));
    const pricer = await nightPricer(tx, tenant.id, tenant.timezone, m.roomTypeId, from, to);
    for (const d of dates) {
      const base = nightlyBase(d, plan, seasons);
      const season = seasons.find((s) => s.startDate <= d && d <= s.endDate);
      const l = byDate.get(d);
      const rate = pricer ? pricer.price(d, base) : base;
      const minStay = Math.max(plan.minStay, season?.minStay ?? 0, l?.minStay ?? 0, 1);
      put(`rs:${m.externalRatePlanId}`, d, JSON.stringify({ rate, stopSell: !plan.active || !!l?.closed, minStay }));
    }
  }
  return { values, from, to };
}

/** Group consecutive dates with the same value into ranges. */
function ranges(changes: [string, string][]) {
  const out: { from: string; to: string; value: string }[] = [];
  for (const [d, v] of changes.sort((a, b) => a[0].localeCompare(b[0]))) {
    const last = out.at(-1);
    if (last && last.value === v && addDays(last.to, 1) === d) last.to = d;
    else out.push({ from: d, to: d, value: v });
  }
  return out;
}

/** Push only what changed since the last successful push. */
export async function pushAri(tenant: TenantInfo, connectionId: string) {
  const c = await withTenant(tenant.id, async (tx) => (await tx.select().from(channelConnections).where(eq(channelConnections.id, connectionId)))[0]);
  if (!c || c.status !== 'active') return { availability: 0, restrictions: 0 };
  const { values, from, to } = await withTenant(tenant.id, (tx) => currentAri(tx, tenant, c));
  const prev = await withTenant(tenant.id, (tx) => tx.select().from(channelAriState).where(and(eq(channelAriState.connectionId, c.id), gte(channelAriState.date, from), lt(channelAriState.date, to))));
  const old = new Map(prev.map((p) => [`${p.key}|${p.date}`, p.value]));
  const avail: AvailabilityUpdate[] = [];
  const restr: RestrictionUpdate[] = [];
  const changedRows: { key: string; date: string; value: string }[] = [];
  for (const [key, byDate] of values) {
    const changed = [...byDate].filter(([d, v]) => old.get(`${key}|${d}`) !== v);
    for (const [date, value] of changed) changedRows.push({ key, date, value });
    for (const r of ranges(changed)) {
      if (key.startsWith('av:')) avail.push({ externalRoomTypeId: key.slice(3), dateFrom: r.from, dateTo: r.to, availability: Number(r.value) });
      else { const v = JSON.parse(r.value) as { rate: number; stopSell: boolean; minStay: number }; restr.push({ externalRatePlanId: key.slice(3), dateFrom: r.from, dateTo: r.to, ...v }); }
    }
  }
  const adapter = ADAPTERS[c.provider];
  try {
    await adapter.pushAvailability(connFor(c), avail);
    await adapter.pushRestrictions(connFor(c), restr);
  } catch (e) {
    await withTenant(tenant.id, (tx) => tx.update(channelConnections).set({ lastError: (e as Error).message.slice(0, 300) }).where(eq(channelConnections.id, c.id)));
    await log(tenant.id, c.id, 'push', false, (e as Error).message);
    throw e;
  }
  await withTenant(tenant.id, async (tx) => {
    for (let i = 0; i < changedRows.length; i += 500) {
      await tx.insert(channelAriState).values(changedRows.slice(i, i + 500).map((r) => ({ tenantId: tenant.id, connectionId: c.id, ...r })))
        .onConflictDoUpdate({ target: [channelAriState.connectionId, channelAriState.key, channelAriState.date], set: { value: sql`excluded.value` } });
    }
    await tx.update(channelConnections).set({ lastPushAt: new Date(), lastError: null }).where(eq(channelConnections.id, c.id));
  });
  if (avail.length || restr.length) await log(tenant.id, c.id, 'push', true, `Sent ${avail.length} availability and ${restr.length} rate/restriction range${restr.length === 1 ? '' : 's'}`);
  return { availability: avail.length, restrictions: restr.length };
}

/** Apply one OTA booking revision. Returns a short outcome for the log. */
async function applyRevision(tenant: TenantInfo, c: Connection, r: ExternalBooking): Promise<string> {
  return withTenant(tenant.id, async (tx) => {
    const [existing] = await tx.select().from(bookings).where(and(eq(bookings.tenantId, tenant.id), eq(bookings.channelRef, r.externalId)));
    if (r.status === 'cancelled') {
      if (!existing) return `Cancellation for unknown ${r.externalId} ignored`;
      if (!['confirmed', 'pending_payment'].includes(existing.status)) return `${existing.reference} already ${existing.status}`;
      await cancelBooking(tx, tenant, existing.id, { by: 'system', waiveFee: true, reason: `Cancelled on ${r.channel}` });
      return `${existing.reference} cancelled (${r.channel})`;
    }
    const [m] = await tx.select().from(channelMappings).where(and(eq(channelMappings.connectionId, c.id), eq(channelMappings.externalRatePlanId, r.externalRatePlanId)));
    if (!m) throw new Error(`No mapping for the channel's rate plan ${r.externalRatePlanId} — add it in Channel manager`);
    if (existing && r.status === 'modified') {
      if (existing.checkIn === r.checkIn && existing.checkOut === r.checkOut && existing.adults === r.adults && existing.children === r.children) {
        await tx.update(bookings).set({ channelTotal: r.total }).where(eq(bookings.id, existing.id));
        return `${existing.reference} updated`;
      }
      try {
        await modifyBooking(tx, tenant, existing.id, { checkIn: r.checkIn, checkOut: r.checkOut, adults: r.adults, children: r.children, roomTypeId: m.roomTypeId, ratePlanId: m.ratePlanId });
        await tx.update(bookings).set({ channelTotal: r.total }).where(eq(bookings.id, existing.id));
        return `${existing.reference} changed to ${r.checkIn} → ${r.checkOut}`;
      } catch (e) {
        await tx.update(bookings).set({ channelIssue: 'modification_failed' }).where(eq(bookings.id, existing.id));
        return `${existing.reference}: ${r.channel} changed it to ${r.checkIn} → ${r.checkOut} but we couldn't apply it (${(e as Error).message}) — fix it on the tape chart`;
      }
    }
    if (existing) return `${existing.reference} already received`;
    const { booking } = await createBooking(tx, tenant, {
      roomTypeId: m.roomTypeId, ratePlanId: m.ratePlanId, checkIn: r.checkIn, checkOut: r.checkOut, adults: r.adults, children: r.children,
      guest: { email: r.guest.email || `ota-${r.externalId.replace(/[^\w-]/g, '')}@channel.invalid`, firstName: r.guest.firstName, lastName: r.guest.lastName, phone: r.guest.phone },
      paymentMethod: 'pay_at_property', source: 'ota', specialRequests: r.notes, channel: { ref: r.externalId, name: r.channel, total: r.total },
    });
    return booking.channelIssue === 'overbooked' ? `OVERBOOKED: ${booking.reference} from ${r.channel} (${r.checkIn} → ${r.checkOut}) — no room left; move a guest on the tape chart` : `${booking.reference} received from ${r.channel}`;
  });
}

/** Pull OTA bookings; each is applied in its own transaction and acknowledged only once applied. */
export async function pullBookings(tenant: TenantInfo, connectionId: string) {
  const c = await withTenant(tenant.id, async (tx) => (await tx.select().from(channelConnections).where(eq(channelConnections.id, connectionId)))[0]);
  if (!c || c.status !== 'active') return { applied: 0, failed: 0 };
  const adapter = ADAPTERS[c.provider];
  const revs = await adapter.fetchBookings(connFor(c));
  let applied = 0, failed = 0;
  for (const r of revs) {
    try {
      const outcome = await applyRevision(tenant, c, r);
      await adapter.ack(connFor(c), r.revisionId);
      await log(tenant.id, c.id, 'pull', !outcome.startsWith('OVERBOOKED') && !outcome.includes("couldn't apply"), outcome);
      applied++;
    } catch (e) {
      failed++;
      await log(tenant.id, c.id, 'pull', false, `${r.channel} ${r.externalId}: ${(e as Error).message}`);
    }
  }
  await withTenant(tenant.id, (tx) => tx.update(channelConnections).set({ lastPullAt: new Date(), lastError: failed ? `${failed} booking(s) couldn't be applied — see the log` : null }).where(eq(channelConnections.id, c.id)));
  return { applied, failed };
}

/** Bookings first (they change availability), then push the resulting calendar. */
export async function syncConnection(tenant: TenantInfo, connectionId: string) {
  const pulled = await pullBookings(tenant, connectionId);
  const pushed = await pushAri(tenant, connectionId);
  return { ...pulled, ...pushed };
}

/** Worker: every active connection of every active tenant with room booking. */
export async function syncAllChannels() {
  const list = await asSystem((tx) => tx.select({ id: channelConnections.id, tenantId: channelConnections.tenantId }).from(channelConnections).where(eq(channelConnections.status, 'active')));
  let ok = 0, failed = 0;
  for (const c of list) {
    const t = await loadTenant(c.tenantId);
    if (!t || t.status !== 'active' || !t.modules.has('room_booking')) continue;
    try { await syncConnection(t, c.id); ok++; } catch { failed++; }
  }
  return { ok, failed };
}

