import { expect, test } from '@playwright/test';
import { ADMIN, guard, OWNER } from './helpers';

async function signIn(page: import('@playwright/test').Page, email: string, password: string) {
  await page.goto(`${ADMIN}/admin/login`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })).toBeVisible();
}

test('a housekeeper signs in by PIN on a shared device and cleans a room by scanning its QR', async ({ page }) => {
  const done = guard(page);
  // 1. The housekeeper sets a shift PIN on their own account.
  await signIn(page, 'housekeeping@seabreeze.example', 'Staff!2026');
  await page.goto(`${ADMIN}/admin/account`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel(/^PIN/).fill('4827');
  await page.getByLabel('Your password').fill('Staff!2026');
  await page.getByRole('button', { name: 'Set PIN' }).click();
  await expect(page.getByText('PIN saved')).toBeVisible();
  await page.locator('aside').getByRole('button', { name: 'Sign out' }).click();

  // 2. The owner makes this browser a shared device.
  await signIn(page, OWNER.email, OWNER.password);
  await page.goto(`${ADMIN}/admin/settings/staff`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: 'Shared devices' }).click();
  await page.getByLabel('Make this browser a shared device').fill('Housekeeping phone');
  await page.getByRole('button', { name: 'Set up' }).click();
  await expect(page.getByTestId('devices')).toContainText('Housekeeping phone');
  await page.locator('aside').getByRole('button', { name: 'Switch user' }).click();

  // 3. PIN pad: tap your name, enter the PIN.
  await expect(page).toHaveURL(/\/admin\/pin/);
  await page.getByRole('button', { name: 'Lakshmi Pillai' }).click();
  for (const d of '4829') await page.getByTestId('pin-pad').getByRole('button', { name: d, exact: true }).click();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Incorrect PIN')).toBeVisible();
  for (const d of '4827') await page.getByTestId('pin-pad').getByRole('button', { name: d, exact: true }).click();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })).toBeVisible();
  await expect(page.locator('aside')).toContainText('Lakshmi Pillai');

  // 4. Scan a room's code and clean it.
  await page.goto(`${ADMIN}/admin/housekeeping-qr`, { waitUntil: 'domcontentloaded' });
  const url = await page.getByTestId('qr-sheet').locator('figure').first().getAttribute('data-url');
  await page.goto(url!, { waitUntil: 'domcontentloaded' });
  const scan = page.getByTestId('room-scan');
  await expect(scan.getByRole('heading', { level: 1 })).toContainText('Room');
  await scan.getByRole('button', { name: /Start (cleaning|a touch-up)/ }).click();
  await scan.getByRole('button', { name: 'Done — room is clean' }).click();
  await expect(scan.getByText('Clean', { exact: true })).toBeVisible();
  done();
});
