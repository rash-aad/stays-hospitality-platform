/** Pure pricing logic for room stays — no I/O, fully unit-tested. Money is integer minor units. */

export type RatePlanInput = {
  basePrice: number;
  weekendPrice: number | null;
  extraAdultPrice: number;
  extraChildPrice: number;
};
export type SeasonInput = { startDate: string; endDate: string; price: number };
export type TaxInput = { id: string; name: string; appliesTo: string; rateBps: number; minAmount: number | null; maxAmount: number | null; inclusive: boolean };
export type CouponInput = { code: string; discountType: 'percent' | 'fixed'; value: number; minNights: number };
export type AddOnInput = { id: string; name: string; price: number; per: 'stay' | 'night' | 'guest' | 'guest_night' };

export type Quote = {
  nights: { date: string; price: number }[];
  roomSubtotal: number;
  addOns: { id: string; name: string; amount: number; taxAmount: number }[];
  discount: number;
  taxes: { name: string; amount: number }[];
  subtotal: number;
  taxTotal: number;
  total: number;
  couponApplied: string | null;
  couponError: string | null;
};

export function eachNight(checkIn: string, checkOut: string): string[] {
  const out: string[] = [];
  const d = new Date(`${checkIn}T00:00:00Z`);
  const end = new Date(`${checkOut}T00:00:00Z`);
  while (d < end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const isWeekendNight = (date: string) => {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return dow === 5 || dow === 6; // Friday and Saturday nights
};

export function nightlyBase(date: string, plan: RatePlanInput, seasons: SeasonInput[]): number {
  const season = seasons
    .filter((s) => s.startDate <= date && date <= s.endDate)
    .sort((a, b) => (a.startDate < b.startDate ? 1 : -1))[0];
  if (season) return season.price;
  if (plan.weekendPrice != null && isWeekendNight(date)) return plan.weekendPrice;
  return plan.basePrice;
}

export function occupancySurcharge(plan: RatePlanInput, baseOccupancy: number, adults: number, children: number) {
  const extraAdults = Math.max(0, adults - baseOccupancy);
  const freeChildSlots = Math.max(0, baseOccupancy - adults);
  const extraChildren = Math.max(0, children - freeChildSlots);
  return extraAdults * plan.extraAdultPrice + extraChildren * plan.extraChildPrice;
}

/** Pick the tax slab for a unit price (e.g. Indian hotel GST: 12% up to ₹7,500/night, 18% above). */
export function taxFor(taxes: TaxInput[], appliesTo: string, unitPrice: number): TaxInput[] {
  return taxes.filter(
    (t) => t.appliesTo === appliesTo && (t.minAmount == null || unitPrice >= t.minAmount) && (t.maxAmount == null || unitPrice <= t.maxAmount),
  );
}

export function taxAmount(amount: number, rateBps: number, inclusive: boolean): number {
  if (inclusive) return Math.round(amount - amount / (1 + rateBps / 10_000));
  return Math.round((amount * rateBps) / 10_000);
}

export function quoteStay(input: {
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  baseOccupancy: number;
  plan: RatePlanInput;
  seasons: SeasonInput[];
  taxes: TaxInput[];
  coupon?: CouponInput | null;
  addOns?: AddOnInput[];
}): Quote {
  const dates = eachNight(input.checkIn, input.checkOut);
  const surcharge = occupancySurcharge(input.plan, input.baseOccupancy, input.adults, input.children);
  const nights = dates.map((date) => ({ date, price: nightlyBase(date, input.plan, input.seasons) + surcharge }));
  const roomSubtotal = nights.reduce((s, n) => s + n.price, 0);

  let discount = 0;
  let couponApplied: string | null = null;
  let couponError: string | null = null;
  if (input.coupon) {
    if (dates.length < input.coupon.minNights) couponError = `This code needs a stay of at least ${input.coupon.minNights} nights`;
    else {
      discount = input.coupon.discountType === 'percent' ? Math.round((roomSubtotal * input.coupon.value) / 100) : input.coupon.value;
      discount = Math.min(discount, roomSubtotal);
      couponApplied = input.coupon.code;
    }
  }

  // Room tax is assessed per night on the tariff actually charged (after discount share).
  const taxLines = new Map<string, number>();
  const addTax = (name: string, amt: number) => taxLines.set(name, (taxLines.get(name) ?? 0) + amt);
  let inclusiveTax = 0;
  for (const n of nights) {
    const share = roomSubtotal > 0 ? Math.round((discount * n.price) / roomSubtotal) : 0;
    const charged = n.price - share;
    for (const t of taxFor(input.taxes, 'room', charged)) {
      const amt = taxAmount(charged, t.rateBps, t.inclusive);
      addTax(t.name, amt);
      if (t.inclusive) inclusiveTax += amt;
    }
  }

  const guests = input.adults + input.children;
  const addOns = (input.addOns ?? []).map((a) => {
    const qty = a.per === 'stay' ? 1 : a.per === 'night' ? dates.length : a.per === 'guest' ? guests : guests * dates.length;
    const amount = a.price * qty;
    let tax = 0;
    for (const t of taxFor(input.taxes, 'service', a.price)) {
      const amt = taxAmount(amount, t.rateBps, t.inclusive);
      addTax(t.name, amt);
      if (t.inclusive) inclusiveTax += amt;
      else tax += amt;
    }
    return { id: a.id, name: a.name, amount, taxAmount: tax };
  });

  const subtotal = roomSubtotal + addOns.reduce((s, a) => s + a.amount, 0);
  const taxes = [...taxLines].map(([name, amount]) => ({ name, amount }));
  const taxTotal = taxes.reduce((s, t) => s + t.amount, 0);
  const total = subtotal - discount + taxTotal - inclusiveTax;
  return { nights, roomSubtotal, addOns, discount, taxes, subtotal, taxTotal, total, couponApplied, couponError };
}

/** Cancellation fee under a policy: free until N hours before arrival, then a percentage of the total. */
export function cancellationFee(
  policy: { freeUntilHours: number; penaltyPercent: number },
  refundable: boolean,
  total: number,
  arrival: Date,
  now: Date,
): number {
  if (!refundable) return total;
  const hoursBefore = (arrival.getTime() - now.getTime()) / 3_600_000;
  if (hoursBefore >= policy.freeUntilHours) return 0;
  return Math.round((total * policy.penaltyPercent) / 100);
}
