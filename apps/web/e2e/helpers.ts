import { createHmac } from 'node:crypto';
import { expect, type Browser, type Page } from '@playwright/test';

export const SITE = 'http://seabreeze.localhost:3000';
export const CITY = 'http://printworks.localhost:3000';
export const ADMIN = 'http://localhost:3000';
export const PLATFORM = 'http://localhost:3001';
export const OWNER = { email: 'owner@seabreeze.example', password: 'Seabreeze!2026' };

export function isoDay(offset: number) {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const utr = () => `4${String(Date.now()).slice(-8)}${Math.floor(Math.random() * 900 + 100)}`;
export const uniqueEmail = (p = 'guest') => `${p}.${Date.now()}.${Math.floor(Math.random() * 1e4)}@example.com`;

/** Fail the test on any uncaught page error or unexpected dialog (e.g. an injected alert). */
export function guard(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => { errors.push(`unexpected dialog: ${d.message()}`); void d.dismiss(); });
  return () => expect(errors, errors.join('\n')).toEqual([]);
}

export async function staffPage(browser: Browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${ADMIN}/admin/login`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  await page.getByLabel('Email').fill(OWNER.email);
  await page.getByLabel('Password').fill(OWNER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })).toBeVisible();
  return page;
}

/** Read the newest email to an address from Mailpit and return the first link matching a pattern. */
export async function linkFromEmail(to: string, pattern: RegExp, timeoutMs = 30_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const s = await (await fetch(`http://localhost:8025/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`)).json();
    for (const m of s.messages ?? []) {
      const full = await (await fetch(`http://localhost:8025/api/v1/message/${m.ID}`)).json();
      const hit = (full.Text as string).match(pattern);
      if (hit) return hit[0];
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`No email to ${to} matching ${pattern}`);
}

/** Book a room through the public site and land on the pay page. */
export async function bookRoom(page: Page, opts: { email: string; first: string; last: string; checkIn: string; checkOut: string; room?: string; rate?: string; pay: RegExp }) {
  await page.goto(`${SITE}/book?checkIn=${opts.checkIn}&checkOut=${opts.checkOut}&adults=2&children=0`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('results')).toBeVisible();
  const room = page.locator('article', { has: page.getByRole('heading', { name: opts.room ?? 'Garden Room' }) });
  await room.locator('li', { hasText: opts.rate ?? 'Bed & breakfast' }).getByRole('button', { name: 'Select' }).click();
  await expect(page.getByTestId('total')).toBeVisible();
  await page.locator('input[name=firstName]').fill(opts.first);
  await page.locator('input[name=lastName]').fill(opts.last);
  await page.locator('input[name=email]').fill(opts.email);
  await page.locator('input[name=phone]').fill('+91 98470 12345');
  await page.getByLabel(opts.pay).check();
  await page.getByRole('button', { name: /Continue to payment|Confirm booking/ }).click();
  await page.waitForURL(/\/book\/pay\//);
  return page.url();
}

/** RFC 6238 code for a base32 secret (what an authenticator app would show), offset in 30 s steps. */
export function totpCode(secret: string, stepOffset = 0) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0;
  const bytes: number[] = [];
  for (const ch of secret.toUpperCase()) { value = (value << 5) | A.indexOf(ch); bits += 5; if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + stepOffset));
  const h = createHmac('sha1', Buffer.from(bytes)).update(msg).digest();
  const o = h[h.length - 1]! & 0xf;
  return String((((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!) % 1_000_000).padStart(6, '0');
}
