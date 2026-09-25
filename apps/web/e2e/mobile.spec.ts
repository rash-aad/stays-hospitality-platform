import { expect, test } from '@playwright/test';
import { guard, isoDay, SITE } from './helpers';

test('mobile: site menu, booking bar and portal sign-in fit a phone', async ({ page }) => {
  const done = guard(page);
  await page.goto(SITE, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(page.getByRole('navigation', { name: 'Site' }).getByRole('link', { name: 'Rooms' })).toBeVisible();
  await page.getByRole('button', { name: 'Close menu' }).click();
  // No horizontal scrolling on a phone.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: 'Check availability' }).click();
  await page.waitForURL(/\/book\?/);
  await expect(page.getByTestId('results')).toBeVisible();
  await page.goto(`${SITE}/book?checkIn=${isoDay(5)}&checkOut=${isoDay(6)}`, { waitUntil: 'domcontentloaded' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  await page.goto(`${SITE}/stay`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('guest-signin')).toBeVisible();
  // The PWA manifest is served per property.
  const m = await (await page.request.get(`${SITE}/manifest.webmanifest`)).json();
  expect(m.name).toBe('Seabreeze Cherai');
  expect(m.display).toBe('standalone');
  done();
});
