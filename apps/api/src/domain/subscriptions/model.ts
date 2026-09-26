/** Pure subscription maths — dates are YYYY-MM-DD, money is integer paise. */
export type Cycle = 'monthly' | 'yearly';
export type SubState = 'trial' | 'active' | 'due' | 'overdue' | 'lapsed' | 'suspended' | 'comp' | 'cancelled';

export const addDaysISO = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const maxISO = (a: string, b: string) => (a > b ? a : b);

/** Add calendar months, clamping to the month's last day (31 Jan + 1 month = 28/29 Feb). */
export function addMonthsISO(d: string, months: number) {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return target.toISOString().slice(0, 10);
}

/** Last covered day of a period that starts on `start`: one month or one year, inclusive. */
export const periodEnd = (start: string, cycle: Cycle) => addDaysISO(addMonthsISO(start, cycle === 'monthly' ? 1 : 12), -1);

export type SubLike = { status: 'trial' | 'active' | 'comp' | 'cancelled'; trialEndsAt: string; paidUntil: string | null; suspendedReason: 'non_payment' | null };

/** The last day the property is covered (trial or paid). */
export const coveredUntil = (s: Pick<SubLike, 'trialEndsAt' | 'paidUntil'>) => (s.paidUntil ? maxISO(s.paidUntil, s.trialEndsAt) : s.trialEndsAt);

/**
 * Where a new period starts. Paying early never loses days: it starts the day after the current cover.
 * If cover lapsed beyond the grace period (the property was offline), it starts today instead — no
 * charge for days the property couldn't use.
 */
export function nextPeriodStart(s: SubLike, today: string, graceDays: number) {
  const end = coveredUntil(s);
  return daysBetween(end, today) > graceDays ? today : addDaysISO(end, 1);
}

export function subscriptionState(s: SubLike, today: string, graceDays: number, tenantSuspended: boolean) {
  const end = coveredUntil(s);
  const daysLeft = daysBetween(today, end); // ≥ 0 while covered
  const graceLeft = graceDays + daysLeft; // days until suspension once past the end
  let state: SubState;
  if (s.status === 'comp') state = 'comp';
  else if (s.status === 'cancelled') state = 'cancelled';
  else if (tenantSuspended && s.suspendedReason) state = 'suspended';
  else if (daysLeft >= 0) state = !s.paidUntil ? 'trial' : daysLeft <= 7 ? 'due' : 'active';
  else state = graceLeft >= 0 ? 'overdue' : 'lapsed';
  return { state, coveredUntil: end, daysLeft, graceLeft };
}

/** GST: CGST + SGST inside bookEZ's state, IGST across states (or if either state is unknown). */
export function gstFor(amount: number, rateBps: number, supplierState: string | null, recipientState: string | null) {
  const tax = Math.round((amount * rateBps) / 10_000);
  if (supplierState && recipientState && supplierState === recipientState) {
    const cgst = Math.floor(tax / 2);
    return { cgst, sgst: tax - cgst, igst: 0, tax, total: amount + tax };
  }
  return { cgst: 0, sgst: 0, igst: tax, tax, total: amount + tax };
}

/** Monthly/yearly options the tenant may pick, with GST and the yearly saving vs 12 × monthly. */
export function priceOptions(fees: { monthlyFee: number | null; yearlyFee: number | null }, rateBps: number) {
  const tax = (amount: number) => Math.round((amount * rateBps) / 10_000);
  const out: { cycle: Cycle; amount: number; tax: number; total: number; saving: number }[] = [];
  if (fees.monthlyFee) out.push({ cycle: 'monthly', amount: fees.monthlyFee, tax: tax(fees.monthlyFee), total: fees.monthlyFee + tax(fees.monthlyFee), saving: 0 });
  if (fees.yearlyFee) out.push({ cycle: 'yearly', amount: fees.yearlyFee, tax: tax(fees.yearlyFee), total: fees.yearlyFee + tax(fees.yearlyFee), saving: fees.monthlyFee ? Math.max(0, fees.monthlyFee * 12 - fees.yearlyFee) : 0 });
  return out;
}
