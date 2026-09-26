import { describe, expect, it } from 'vitest';
import { dynamicPrice, type PricingRuleInput } from '../src/domain/bookings/pricing.js';
import { app, createTenant, isoDate, uniq, useApp, type TestTenant } from './helpers.js';

const rule = (r: Partial<PricingRuleInput> & Pick<PricingRuleInput, 'kind' | 'params' | 'adjustPct'>): PricingRuleInput => ({ name: r.kind, roomTypeId: null, ...r });

describe('dynamic pricing (pure)', () => {
  const ctx = { date: '2027-03-06', occupancyPct: 85, leadDays: 2 }; // a Saturday
  it('uses only the highest occupancy tier reached', () => {
    const rules = [rule({ kind: 'occupancy', params: { minOccupancyPct: 50 }, adjustPct: 10 }), rule({ kind: 'occupancy', params: { minOccupancyPct: 80 }, adjustPct: 25 }), rule({ kind: 'occupancy', params: { minOccupancyPct: 95 }, adjustPct: 50 })];
    expect(dynamicPrice(800000, ctx, rules).price).toBe(1000000);
  });
  it('stacks lead-time and weekday rules, rounds to rupees, and respects guardrails', () => {
    const rules = [rule({ kind: 'lead_time', params: { maxDays: 3 }, adjustPct: -10 }), rule({ kind: 'day_of_week', params: { days: [6] }, adjustPct: 15 })];
    expect(dynamicPrice(812345, ctx, rules).price).toBe(840800); // 812345 × 0.9 × 1.15 = 840783 → ₹8,408
    expect(dynamicPrice(800000, ctx, rules, { ceiling: 820000 }).price).toBe(820000);
    expect(dynamicPrice(800000, ctx, [rule({ kind: 'lead_time', params: { maxDays: 3 }, adjustPct: -40 })], { floor: 600000 }).price).toBe(600000);
  });
  it('leaves the base untouched (even under a floor) when no rule applies', () => {
    expect(dynamicPrice(500000, ctx, [rule({ kind: 'lead_time', params: { minDays: 30 }, adjustPct: -10 })], { floor: 600000 })).toEqual({ price: 500000, applied: [] });
  });
});

useApp();

async function quote(t: TestTenant, inDays: number) {
  const r = await app.inject({ method: 'POST', url: '/api/v1/public/booking/quote', headers: t.host, payload: { roomTypeId: t.roomType.id, ratePlanId: t.ratePlan.id, checkIn: isoDate(inDays), checkOut: isoDate(inDays + 1), adults: 2, children: 0 } });
  expect(r.statusCode).toBe(200);
  return r.json().data.quote.nights[0].price as number;
}

describe('pricing rules through the booking engine', () => {
  it('prices by occupancy and lead time, clamps to guardrails, previews drafts, and drives the scarcity nudge', async () => {
    const t = await createTenant({ rooms: 2 }); // base ₹8,000
    const add = (body: object) => app.inject({ method: 'POST', url: '/api/v1/admin/pricing-rules', headers: t.auth, payload: body });
    expect((await add({ name: 'Bad', roomTypeId: null, kind: 'occupancy', params: {}, adjustPct: 10 })).statusCode).toBe(400);
    expect((await add({ name: 'Half full', roomTypeId: null, kind: 'occupancy', params: { minOccupancyPct: 50 }, adjustPct: 20 })).statusCode).toBe(201);
    const early = await add({ name: 'Early bird', roomTypeId: t.roomType.id, kind: 'lead_time', params: { minDays: 60 }, adjustPct: -15 });
    expect(early.statusCode).toBe(201);

    expect(await quote(t, 20)).toBe(800000);
    expect(await quote(t, 70)).toBe(680000);
    // Fill one of two rooms for night +20: 50 % → +20 %.
    const b = await app.inject({ method: 'POST', url: '/api/v1/public/bookings', headers: { ...t.host, 'idempotency-key': uniq('k') }, payload: { roomTypeId: t.roomType.id, ratePlanId: t.ratePlan.id, checkIn: isoDate(20), checkOut: isoDate(21), adults: 2, children: 0, guest: { email: `${uniq('g')}@example.com`, firstName: 'A', lastName: 'B', phone: '+919800000000' }, paymentMethod: 'pay_at_property' } });
    expect(b.json().data.total).toBeGreaterThan(0);
    expect(await quote(t, 20)).toBe(960000);

    // Guardrail: ceiling ₹9,000.
    expect((await app.inject({ method: 'PUT', url: `/api/v1/admin/revenue/guardrails/${t.roomType.id}`, headers: t.auth, payload: { priceFloor: 900001, priceCeiling: 900000 } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'PUT', url: `/api/v1/admin/revenue/guardrails/${t.roomType.id}`, headers: t.auth, payload: { priceFloor: 700000, priceCeiling: 900000 } })).statusCode).toBe(200);
    expect(await quote(t, 20)).toBe(900000);
    expect(await quote(t, 70)).toBe(700000);

    const ov = (await app.inject({ method: 'GET', url: '/api/v1/admin/revenue/overview?days=30', headers: t.auth })).json();
    const night = ov.data.roomTypes[0].nights.find((n: { date: string }) => n.date === isoDate(20));
    expect(night).toMatchObject({ base: 800000, price: 900000, occupancyPct: 50, left: 1, applied: ['Half full'] });
    expect(ov.data.house.find((h: { date: string }) => h.date === isoDate(20)).pickup).toBe(1);

    // Preview a weekend rule without saving it.
    const pv = await app.inject({ method: 'POST', url: '/api/v1/admin/revenue/preview', headers: t.auth, payload: { rule: { name: 'Weekend', roomTypeId: null, kind: 'day_of_week', params: { days: [0, 1, 2, 3, 4, 5, 6] }, adjustPct: -5 } } });
    expect(pv.json().data.roomTypes[0].nights[0].applied).toContain('Weekend');
    expect((await app.inject({ method: 'GET', url: '/api/v1/admin/pricing-rules', headers: t.auth })).json().data).toHaveLength(2);

    // Scarcity nudge threshold.
    const search = async () => (await app.inject({ method: 'GET', url: `/api/v1/public/stay-search?checkIn=${isoDate(20)}&checkOut=${isoDate(21)}&adults=2&children=0`, headers: t.host })).json().data.results[0].unitsLeft;
    expect(await search()).toBe(1);
    await app.inject({ method: 'PUT', url: '/api/v1/admin/revenue/settings', headers: t.auth, payload: { scarcityThreshold: 0 } });
    expect(await search()).toBeNull();
  });
});
