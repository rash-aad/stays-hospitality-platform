import { expect, test } from '@playwright/test';
import { ADMIN, guard, staffPage } from './helpers';

test('revenue manager previews and saves a pricing rule, and the grid shows adjusted prices', async ({ browser }) => {
  const page = await staffPage(browser);
  const done = guard(page);
  await page.goto(`${ADMIN}/admin/revenue`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('revenue-grid')).toBeVisible();
  await page.getByRole('button', { name: 'Add pricing rule' }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Name').fill('Midweek saver');
  await d.getByLabel('When').selectOption('day_of_week');
  for (const day of ['Fri', 'Sat']) await d.getByLabel(day).uncheck();
  for (const day of ['Mon', 'Tue', 'Wed', 'Thu']) await d.getByLabel(day).check();
  await d.getByLabel(/Change the price by/).fill('-10');
  await d.getByRole('button', { name: 'Preview' }).click();
  await expect(page.getByTestId('preview-banner')).toBeVisible();
  await expect(page.getByTestId('revenue-grid').locator('td.bg-accent-soft').first()).toBeVisible();
  await d.getByRole('button', { name: 'Save rule' }).click();
  await expect(page.getByTestId('rules')).toContainText('Midweek saver');
  await expect(page.getByTestId('rules')).toContainText('-10% on Mon, Tue, Wed, Thu nights');
  await expect(page.getByTestId('preview-banner')).toBeHidden();
  // Clean up so later tests see the seeded prices.
  await page.getByTestId('rules').locator('li', { hasText: 'Midweek saver' }).getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByTestId('rules')).toBeHidden();
  done();
});
