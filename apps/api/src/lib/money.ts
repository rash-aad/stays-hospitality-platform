export const toMajor = (minor: number) => (minor / 100).toFixed(2);

export function formatMoney(minor: number, currency: string, locale = 'en-IN') {
  return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: minor % 100 === 0 ? 0 : 2 }).format(minor / 100);
}
