import { expect, test } from '@playwright/test';
import { ADMIN, guard, staffPage } from './helpers';

test('front desk drags an unassigned booking into a room and extends a stay from the chart', async ({ browser }) => {
  const page = await staffPage(browser);
  const done = guard(page);
  await page.goto(`${ADMIN}/admin/tape-chart`, { waitUntil: 'domcontentloaded' });
  const chart = page.getByTestId('tape-chart');
  await expect(chart).toBeVisible();

  // Drag the first unassigned stay onto the first room row of its type.
  const lane = chart.locator('[data-room-row="unassigned"]').first();
  const bar = lane.locator('[data-testid^="bar-"]').first();
  await expect(bar).toBeVisible();
  const ref = (await bar.getAttribute('data-testid'))!.slice(4);
  const section = lane.locator('xpath=ancestor::section[1]');
  const roomId = await section.locator('[data-room-row]:not([data-room-row="unassigned"])').last().getAttribute('data-room-row');
  const room = chart.locator(`[data-room-row="${roomId}"]`);
  const from = (await bar.boundingBox())!;
  const to = (await room.boundingBox())!;
  await page.mouse.move(from.x + 8, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 12, to.y + to.height / 2, { steps: 8 });
  await page.mouse.up();
  const dialog = page.getByTestId('move-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Room')).not.toHaveValue('');
  await page.getByRole('button', { name: 'Move booking' }).click();
  await expect(page.getByText('Booking moved')).toBeVisible();
  await expect(room.getByTestId(`bar-${ref}`)).toBeVisible();

  // Keyboard path: open the stay, Move / extend, one more night.
  await room.getByTestId(`bar-${ref}`).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Move / extend' }).click();
  const dep = page.getByTestId('move-dialog').getByLabel('Departure');
  const current = await dep.inputValue();
  const next = new Date(`${current}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  await dep.fill(next.toISOString().slice(0, 10));
  const before = (await room.getByTestId(`bar-${ref}`).boundingBox())!.width;
  await page.getByRole('button', { name: 'Move booking' }).click();
  await expect(page.getByTestId('move-dialog')).toBeHidden();
  await expect.poll(async () => (await room.getByTestId(`bar-${ref}`).boundingBox())!.width).toBeGreaterThan(before + 30);
  done();
});
