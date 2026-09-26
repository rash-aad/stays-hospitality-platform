import { expect, test } from '@playwright/test';
import { ADMIN, guard, staffPage } from './helpers';

test('cashier opens a drawer, takes cash, counts up; the night audit closes the day', async ({ browser }) => {
  const page = await staffPage(browser);
  const done = guard(page);
  await page.goto(`${ADMIN}/admin/cash-drawer`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel(/Opening float/).fill('2000');
  await page.getByRole('button', { name: 'Open drawer' }).click();
  await expect(page.getByTestId('expected-cash')).toHaveText('₹2,000');

  // Take ₹500 cash against an in-house booking.
  await page.goto(`${ADMIN}/admin/reservations?view=in_house`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('row').nth(1).click();
  await page.getByRole('button', { name: 'Record payment' }).click();
  const d = page.getByRole('dialog').last();
  await d.getByLabel('Amount (₹)').fill('500');
  await d.getByLabel(/Paid by/).selectOption('cash');
  await d.getByRole('button', { name: 'Record' }).click();
  await expect(page.getByText('Payment recorded')).toBeVisible();

  await page.goto(`${ADMIN}/admin/cash-drawer`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('expected-cash')).toHaveText('₹2,500');
  await page.getByLabel(/Cash counted/).fill('2450');
  await expect(page.getByText('Short ₹50')).toBeVisible();
  await page.getByLabel('Why doesn’t it match?').fill('Gave wrong change');
  await page.getByRole('button', { name: 'Close drawer' }).click();
  await expect(page.getByRole('button', { name: 'Open drawer' })).toBeVisible();

  // Night audit.
  await page.goto(`${ADMIN}/admin/night-audit`, { waitUntil: 'domcontentloaded' });
  const checks = page.getByTestId('audit-checks');
  await expect(checks).toBeVisible();
  await expect(page.getByTestId('day-figures').first()).toContainText('Occupancy');
  const keep = page.getByLabel('Keep — arriving late');
  if (await keep.count()) await keep.check();
  const close = page.getByRole('button', { name: /^Close / });
  if (await close.isEnabled()) {
    await close.click();
    await expect(page.getByText(/closed — report sent/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Closed days' })).toBeVisible();
  } else {
    // Seed data may include guests due out today who are still in house — the audit must say so.
    await expect(checks).toContainText('still checked in');
  }
  done();
});
