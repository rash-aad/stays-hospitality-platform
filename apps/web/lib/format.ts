export function money(minor: number | null | undefined, currency = 'INR', opts: { exact?: boolean } = {}) {
  if (minor == null) return '—';
  const exact = opts.exact || minor % 100 !== 0;
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency, minimumFractionDigits: exact ? 2 : 0, maximumFractionDigits: exact ? 2 : 0 }).format(minor / 100);
}

export const toMinor = (major: string | number) => Math.round(Number(major) * 100);
export const toMajor = (minor: number | null | undefined) => (minor == null ? '' : (minor / 100).toString());

const tz = 'Asia/Kolkata';
export function date(d: string | Date | null | undefined, style: 'short' | 'medium' | 'long' = 'medium', timeZone = tz) {
  if (!d) return '—';
  const v = typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T00:00:00Z`) : new Date(d);
  const isDateOnly = typeof d === 'string' && d.length === 10;
  const o: Intl.DateTimeFormatOptions = style === 'short' ? { day: 'numeric', month: 'short' } : style === 'medium' ? { day: 'numeric', month: 'short', year: 'numeric' } : { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
  return new Intl.DateTimeFormat('en-IN', { ...o, timeZone: isDateOnly ? 'UTC' : timeZone }).format(v);
}
export function time(d: string | Date | null | undefined, timeZone = tz) {
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(d));
}
export function dateTime(d: string | Date | null | undefined, timeZone = tz) {
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(d));
}
export function ago(d: string | Date | null | undefined) {
  if (!d) return '—';
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
export function until(d: string | Date | null | undefined) {
  if (!d) return '—';
  const s = Math.round((new Date(d).getTime() - Date.now()) / 1000);
  if (s < 0) return `${Math.round(-s / 60)} min overdue`;
  if (s < 3600) return `in ${Math.round(s / 60)} min`;
  if (s < 86400) return `in ${Math.round(s / 3600)} h`;
  return `in ${Math.round(s / 86400)} d`;
}
export function nights(a: string, b: string) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}
export function isoToday(offset = 0) {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const human = (s: string | null | undefined) => (s ?? '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
