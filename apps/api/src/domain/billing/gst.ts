/** Indian GST helpers for hotel tax invoices. */

export const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

// Standard SAC codes for hospitality supplies.
export const SAC = {
  room: '996311', // room or unit accommodation services
  food: '996331', // services provided by restaurants, cafes and similar
  service: '999799', // other services n.e.c. (add-ons, laundry, transfers)
  experience: '999799',
} as const;

export const STATE_NAMES: Record<string, string> = {
  '01': 'Jammu and Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi',
  '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur',
  '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra and Nagar Haveli and Daman and Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa',
  '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry', '35': 'Andaman and Nicobar Islands', '36': 'Telangana',
  '37': 'Andhra Pradesh', '38': 'Ladakh',
};

/** Validates format and the GSTIN check digit (mod-36 algorithm). */
export function isValidGstin(g: string): boolean {
  const v = g.trim().toUpperCase();
  if (!GSTIN_RE.test(v)) return false;
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const code = chars.indexOf(v[i]!);
    const prod = code * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(prod / 36) + (prod % 36);
  }
  const check = chars[(36 - (sum % 36)) % 36];
  return check === v[14];
}

/** Indian financial year label for a date, e.g. 2026-27 (April–March). */
export function financialYear(d: Date, timeZone = 'Asia/Kolkata') {
  const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).format(d).split('-').map(Number) as [number, number];
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** For hotel accommodation the place of supply is the property's location, so GST splits into CGST + SGST. */
export function splitTax(tax: number) {
  const cgst = Math.floor(tax / 2);
  return { cgst, sgst: tax - cgst };
}
