import { describe, expect, it } from 'vitest';
import { cancellationFee, eachNight, quoteStay, type TaxInput } from '../src/domain/bookings/pricing.js';

const plan = { basePrice: 600000, weekendPrice: 750000, extraAdultPrice: 150000, extraChildPrice: 50000 };
const gst: TaxInput[] = [
  { id: '1', name: 'GST 12%', appliesTo: 'room', rateBps: 1200, minAmount: null, maxAmount: 750000, inclusive: false },
  { id: '2', name: 'GST 18%', appliesTo: 'room', rateBps: 1800, minAmount: 750001, maxAmount: null, inclusive: false },
  { id: '3', name: 'GST 18%', appliesTo: 'service', rateBps: 1800, minAmount: null, maxAmount: null, inclusive: false },
];

describe('pricing', () => {
  it('enumerates nights', () => {
    expect(eachNight('2026-12-30', '2027-01-02')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01']);
  });

  it('applies weekend, season and occupancy pricing', () => {
    // 2026-10-01 Thu, 10-02 Fri (weekend), 10-03 Sat (season)
    const q = quoteStay({
      checkIn: '2026-10-01', checkOut: '2026-10-04', adults: 3, children: 0, baseOccupancy: 2, plan,
      seasons: [{ startDate: '2026-10-03', endDate: '2026-10-10', price: 900000 }], taxes: [],
    });
    expect(q.nights.map((n) => n.price)).toEqual([750000, 900000, 1050000]);
    expect(q.total).toBe(2700000);
  });

  it('applies GST slabs per night and taxes add-ons as services', () => {
    const q = quoteStay({
      checkIn: '2026-10-01', checkOut: '2026-10-03', adults: 2, children: 0, baseOccupancy: 2, plan, seasons: [], taxes: gst,
      addOns: [{ id: 'a', name: 'Airport pickup', price: 200000, per: 'stay' }],
    });
    // Thu 6000 → 12%, Fri 7500 → 12% (inclusive of boundary)
    expect(q.taxes.find((t) => t.name === 'GST 12%')!.amount).toBe(72000 + 90000);
    expect(q.addOns[0]!.taxAmount).toBe(36000);
    expect(q.total).toBe(600000 + 750000 + 200000 + 162000 + 36000);
  });

  it('applies coupons and respects minimum nights', () => {
    const base = { checkIn: '2026-10-05', checkOut: '2026-10-07', adults: 2, children: 0, baseOccupancy: 2, plan, seasons: [], taxes: [] };
    const ok = quoteStay({ ...base, coupon: { code: 'STAY10', discountType: 'percent', value: 10, minNights: 2 } });
    expect(ok.discount).toBe(120000);
    expect(ok.total).toBe(1080000);
    const bad = quoteStay({ ...base, coupon: { code: 'LONG', discountType: 'fixed', value: 5000, minNights: 5 } });
    expect(bad.discount).toBe(0);
    expect(bad.couponError).toMatch(/at least 5/);
  });

  it('computes cancellation fees from the policy window', () => {
    const arrival = new Date('2026-10-10T14:00:00Z');
    expect(cancellationFee({ freeUntilHours: 48, penaltyPercent: 100 }, true, 10000, arrival, new Date('2026-10-07T00:00:00Z'))).toBe(0);
    expect(cancellationFee({ freeUntilHours: 48, penaltyPercent: 50 }, true, 10000, arrival, new Date('2026-10-09T00:00:00Z'))).toBe(5000);
    expect(cancellationFee({ freeUntilHours: 48, penaltyPercent: 50 }, false, 10000, arrival, new Date('2026-10-01T00:00:00Z'))).toBe(10000);
  });
});
