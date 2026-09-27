import { expect, test } from '@playwright/test';
import { ADMIN, guard, staffPage } from './helpers';

test('front office connects a channel manager, maps a rate plan and receives an OTA booking', async ({ browser }) => {
  const page = await staffPage(browser);
  const done = guard(page);
  await page.goto(`${ADMIN}/admin/settings/channel-manager`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Provider').selectOption('mock');
  await page.getByLabel('Property ID').fill('TEST-PROPERTY');
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByText('Connected', { exact: true })).toBeVisible();

  const table = page.getByTestId('mappings');
  const row = table.getByRole('row').nth(1);
  await row.getByRole('checkbox').check();
  await row.getByRole('textbox').nth(0).fill('RT-GARDEN');
  await row.getByRole('textbox').nth(1).fill('RP-GARDEN-BB');
  await page.getByRole('button', { name: 'Save mapping' }).click();
  await expect(page.getByText(/Mapping saved/)).toBeVisible();
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByTestId('channel-log')).toContainText(/Sent \d+ availability/);

  await page.getByLabel(/^Channel rate plan/).selectOption('RP-GARDEN-BB');
  await page.getByLabel('Guest name').fill('Farah Khan');
  await page.getByRole('button', { name: 'Send test booking' }).click();
  await expect(page.getByTestId('channel-log')).toContainText(/received from Booking\.com|OVERBOOKED/);

  await page.goto(`${ADMIN}/admin/reservations`, { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('Guest, reference, phone').fill('Farah');
  await page.getByRole('row', { name: /Farah Khan/ }).click();
  await expect(page.getByTestId('channel-info')).toContainText('OTA reference SIM-');

  // Clean up so later tests don't see an active connection.
  await page.goto(`${ADMIN}/admin/settings/channel-manager`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Disconnect' }).click();
  await expect(page.getByText('Disconnected')).toBeVisible();
  done();
});
