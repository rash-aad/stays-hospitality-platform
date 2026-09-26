import { lookup } from 'node:dns';
import { request } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { availability, externalBlocks, icalFeeds } from '@hp/db';
import { and, asc, eq, gte, inArray, or, sql } from 'drizzle-orm';
import type { Tx } from '../../infra/db.js';
import { addDays } from '../../lib/dates.js';
import { ensureLedger, releaseInventory } from '../bookings/inventory.js';
import { eachNight } from '../bookings/pricing.js';

// ---------------------------------------------------------------- parsing

export interface IcalEvent { uid: string; start: string; end: string; summary: string | null }

function icalDate(v: string): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(v.trim());
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Minimal RFC 5545 reader: unfolds lines and returns all-day ranges from VEVENTs (cancelled events skipped). */
export function parseIcal(text: string): IcalEvent[] {
  const lines = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  const out: IcalEvent[] = [];
  let cur: Record<string, string> | null = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') cur = {};
    else if (line === 'END:VEVENT' && cur) {
      const start = cur.DTSTART && icalDate(cur.DTSTART);
      let end = cur.DTEND && icalDate(cur.DTEND);
      if (start && !end) end = addDays(start, 1);
      if (start && end && end > start && cur.STATUS !== 'CANCELLED') {
        out.push({ uid: (cur.UID || `${start}_${end}`).slice(0, 255), start, end, summary: cur.SUMMARY?.slice(0, 200).replace(/\\([,;\\])/g, '$1') ?? null });
      }
      cur = null;
    } else if (cur) {
      const i = line.indexOf(':');
      if (i > 0) cur[line.slice(0, i).split(';')[0]!.toUpperCase()] = line.slice(i + 1);
    }
  }
  return out;
}

// ---------------------------------------------------------------- export

const esc = (s: string) => s.replace(/[\\,;]/g, (c) => `\\${c}`);
const compact = (d: string) => d.replaceAll('-', '');

/** Nights we can't sell (sold out or closed) for the next year, merged into ranges. */
export async function buildExport(tx: Tx, roomTypeId: string, name: string, today: string) {
  const rows = await tx.select({ date: availability.date }).from(availability)
    .where(and(eq(availability.roomTypeId, roomTypeId), gte(availability.date, today), sql`${availability.date} < ${addDays(today, 365)}`,
      or(eq(availability.closed, true), sql`${availability.booked} >= ${availability.total}`)))
    .orderBy(asc(availability.date));
  const ranges: [string, string][] = [];
  for (const { date } of rows) {
    const last = ranges.at(-1);
    if (last && last[1] === date) last[1] = addDays(date, 1);
    else ranges.push([date, addDays(date, 1)]);
  }
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const body = ranges.flatMap(([s, e]) => [
    'BEGIN:VEVENT', `UID:${compact(s)}-${roomTypeId}@bookez.in`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${compact(s)}`, `DTEND;VALUE=DATE:${compact(e)}`, 'SUMMARY:Not available', 'END:VEVENT',
  ]);
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//bookEZ//Availability//EN', `X-WR-CALNAME:${esc(name)}`, 'CALSCALE:GREGORIAN', ...body, 'END:VCALENDAR', ''].join('\r\n');
}

// ---------------------------------------------------------------- safe fetch

const privateRanges = new BlockList();
for (const [net, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3]] as const)
  privateRanges.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['64:ff9b::', 96]] as const) privateRanges.addSubnet(net, bits, 'ipv6');

export function isPublicAddress(ip: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip); // IPv4-mapped IPv6: judge the embedded IPv4
  if (mapped) return isPublicAddress(mapped[1]!);
  const family = isIP(ip);
  return family !== 0 && !privateRanges.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}

/**
 * Fetch a calendar over HTTPS without letting a tenant point us at internal services: the address is
 * checked at connect time (so DNS rebinding can't swap it), redirects are refused, size and time are capped.
 */
export function safeFetchText(url: string, maxBytes = 2_000_000, timeoutMs = 10_000): Promise<string> {
  const u = new URL(url);
  if (u.protocol !== 'https:') return Promise.reject(new Error('Calendar URL must use https'));
  return new Promise((resolve, reject) => {
    const req = request(u, {
      method: 'GET', timeout: timeoutMs, headers: { accept: 'text/calendar', 'user-agent': 'bookEZ-iCal/1.0 (+https://bookez.in)' },
      lookup: (host, opts, cb) => lookup(host, { ...opts, all: false }, (err, address, family) => {
        if (err) return cb(err, '', 0);
        if (!isPublicAddress(address as string)) return cb(new Error('Calendar host resolves to a private address'), '', 0);
        cb(null, address as string, family);
      }),
    }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`Calendar server answered ${res.statusCode}`)); }
      let size = 0;
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => { size += c.length; if (size > maxBytes) { req.destroy(new Error('Calendar is too large')); return; } chunks.push(c); });
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Calendar server timed out')));
    req.on('error', reject);
    req.end();
  });
}

// ---------------------------------------------------------------- import

/** Hold one unit per night for an external reservation; returns false (nothing changed) if any night is already full. */
async function hold(tx: Tx, tenantId: string, roomTypeId: string, start: string, end: string) {
  const dates = eachNight(start, end);
  await ensureLedger(tx, tenantId, roomTypeId, dates);
  const rows = await tx.select().from(availability).where(and(eq(availability.roomTypeId, roomTypeId), inArray(availability.date, dates))).orderBy(asc(availability.date)).for('update');
  if (rows.some((r) => r.booked >= r.total)) return false;
  await tx.update(availability).set({ booked: sql`${availability.booked} + 1` }).where(and(eq(availability.roomTypeId, roomTypeId), inArray(availability.date, dates)));
  return true;
}

export interface SyncResult { added: number; updated: number; removed: number; conflicts: number }

/** Reconcile one import feed's events with its external blocks. Conflicts are recorded, never oversold. */
export async function applyEvents(tx: Tx, feed: typeof icalFeeds.$inferSelect, events: IcalEvent[], today: string): Promise<SyncResult> {
  const horizon = addDays(today, 730);
  const wanted = new Map(events.filter((e) => e.end > today && e.start < horizon && eachNight(e.start, e.end).length <= 90).map((e) => [e.uid, e]));
  const existing = await tx.select().from(externalBlocks).where(eq(externalBlocks.feedId, feed.id));
  const r: SyncResult = { added: 0, updated: 0, removed: 0, conflicts: 0 };

  for (const b of existing) {
    const e = wanted.get(b.uid);
    if (e && e.start === b.startDate && e.end === b.endDate) {
      wanted.delete(b.uid);
      if (b.status === 'conflict' && (await hold(tx, feed.tenantId, feed.roomTypeId, b.startDate, b.endDate))) {
        await tx.update(externalBlocks).set({ status: 'held' }).where(eq(externalBlocks.id, b.id));
        r.updated++;
      } else if (b.status === 'conflict') r.conflicts++;
      continue;
    }
    if (b.status === 'held') await releaseInventory(tx, b.roomTypeId, b.startDate, b.endDate);
    if (!e) { await tx.delete(externalBlocks).where(eq(externalBlocks.id, b.id)); r.removed++; continue; }
    wanted.delete(b.uid);
    const ok = await hold(tx, feed.tenantId, feed.roomTypeId, e.start, e.end);
    await tx.update(externalBlocks).set({ startDate: e.start, endDate: e.end, summary: e.summary, status: ok ? 'held' : 'conflict' }).where(eq(externalBlocks.id, b.id));
    r.updated++;
    if (!ok) r.conflicts++;
  }
  for (const e of wanted.values()) {
    const ok = await hold(tx, feed.tenantId, feed.roomTypeId, e.start, e.end);
    await tx.insert(externalBlocks).values({ tenantId: feed.tenantId, feedId: feed.id, roomTypeId: feed.roomTypeId, uid: e.uid, summary: e.summary, startDate: e.start, endDate: e.end, status: ok ? 'held' : 'conflict' });
    r.added++;
    if (!ok) r.conflicts++;
  }
  return r;
}

/** Remove a feed's holds (used when an import feed is deleted). */
export async function releaseFeed(tx: Tx, feedId: string) {
  const blocks = await tx.select().from(externalBlocks).where(and(eq(externalBlocks.feedId, feedId), eq(externalBlocks.status, 'held')));
  for (const b of blocks) await releaseInventory(tx, b.roomTypeId, b.startDate, b.endDate);
}

