import { expect, test } from '@playwright/test';
import { ADMIN, guard, SITE, staffPage } from './helpers';

test('owner offers Hindi, translates the home page and menu; guests browse and book in Hindi', async ({ browser }) => {
  const page = await staffPage(browser);
  const done = guard(page);
  await page.goto(`${ADMIN}/admin/site`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: 'Languages' }).click();
  await page.getByLabel(/Hindi/).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Languages saved')).toBeVisible();

  // Home page: translate the first text (the hero heading area).
  await page.getByTestId('translate-links').getByRole('row', { name: /^Home/ }).getByRole('link', { name: 'Translate' }).click();
  const table = page.getByTestId('translate-table');
  await expect(table).toBeVisible();
  const headingRow = table.getByRole('row').filter({ hasText: /Hero › Heading/ }).first();
  const english = (await headingRow.locator('td').first().locator('p').nth(1).textContent())!.trim();
  await headingRow.getByRole('textbox').fill('समुद्र के किनारे सुबह');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/Translations saved/)).toBeVisible();

  // A guest chooses Hindi.
  const guest = await (await browser.newContext()).newPage();
  // The site cache refreshes on the next visit after a change (stale-while-revalidate).
  await expect.poll(async () => { await guest.goto(`${SITE}/`, { waitUntil: 'domcontentloaded' }); return guest.getByRole('combobox', { name: 'Language' }).count(); }, { timeout: 20_000 }).toBeGreaterThan(0);
  await expect(guest.getByRole('heading', { level: 1 })).toContainText(english);
  await Promise.all([guest.waitForEvent('load'), guest.getByRole('combobox', { name: 'Language' }).first().selectOption('hi')]);
  await expect.poll(async () => { await guest.goto(`${SITE}/`, { waitUntil: 'domcontentloaded' }); return guest.getByRole('heading', { level: 1 }).textContent(); }, { timeout: 20_000 }).toContain('समुद्र के किनारे सुबह');
  await expect(guest.getByRole('link', { name: 'आपका प्रवास' }).first()).toBeVisible();
  await guest.goto(`${SITE}/book`, { waitUntil: 'domcontentloaded' });
  await expect(guest.getByRole('heading', { name: 'अपना प्रवास बुक करें' })).toBeVisible();
  await expect(guest.getByRole('button', { name: 'खोजें' })).toBeVisible();

  // Back to English only, so the rest of the suite sees the seeded site.
  await page.goto(`${ADMIN}/admin/site`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab', { name: 'Languages' }).click();
  await page.getByLabel(/Hindi/).uncheck();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Languages saved')).toBeVisible();
  done();
});
