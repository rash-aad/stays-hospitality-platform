import { expect, test, type Page } from '@playwright/test';
import { ADMIN, bookRoom, guard, isoDay, linkFromEmail, SITE, staffPage, uniqueEmail, utr } from './helpers';

/**
 * The full guest journey from the spec's Definition of Done, driven through the real UI with a
 * guest and a staff member working side by side.
 */
test.describe.serial('guest journey: discover → book (UPI) → verify → stay → dine → request → bill', () => {
  const email = uniqueEmail('meera');
  let guest: Page;
  let staff: Page;
  let payUrl = '';
  let reference = '';
  let checkGuest: () => void;
  let checkStaff: () => void;

  test.beforeAll(async ({ browser }) => {
    guest = await (await browser.newContext()).newPage();
    checkGuest = guard(guest);
    staff = await staffPage(browser);
    checkStaff = guard(staff);
  });
  test.afterAll(async () => { checkGuest(); checkStaff(); });

  test('discover the property website', async () => {
    await guest.goto(SITE, { waitUntil: 'domcontentloaded' });
    await expect(guest.getByRole('heading', { level: 1 })).toContainText('Wake to the tide');
    await expect(guest.getByRole('heading', { name: 'Rooms & suites' })).toBeVisible();
    await guest.getByRole('link', { name: 'Dining' }).first().click();
    await expect(guest).toHaveURL(/\/dining$/);
    await expect(guest.getByRole('heading', { name: 'Tamarind' })).toBeVisible();
    await guest.getByRole('button', { name: 'From the sea' }).click();
    await expect(guest.getByText('Alleppey prawn curry')).toBeVisible();
  });

  test('book a room and pay to the property’s own UPI ID', async () => {
    payUrl = await bookRoom(guest, { email, first: 'Meera', last: 'Iyer', checkIn: isoDay(0), checkOut: isoDay(2), pay: /Pay now by UPI/ });
    await expect(guest.getByTestId('vpa')).toHaveText(/seabreezecherai@okhdfcbank/);
    await expect(guest.getByLabel('UPI QR code').locator('svg')).toBeVisible();
    reference = (await guest.getByText(/Booking BK-/).textContent())!.match(/BK-[A-Z0-9]+/)![0];
    // Edge: too-short references cannot be submitted.
    await guest.locator('input[name=utr]').fill('12345');
    await expect(guest.getByRole('button', { name: 'Submit' })).toBeDisabled();
    await guest.locator('input[name=utr]').fill(utr());
    await guest.getByRole('button', { name: 'Submit' }).click();
    await expect(guest.getByTestId('verifying')).toBeVisible();
  });

  test('staff reject the unmatched UTR; the guest sees why and resubmits', async () => {
    await staff.goto(`${ADMIN}/admin/payments`, { waitUntil: 'domcontentloaded' });
    const item = staff.locator('li', { hasText: reference });
    await expect(item).toBeVisible();
    await item.getByRole('button', { name: 'Not received' }).click();
    await staff.getByLabel('Message to the guest').fill('No credit found for this reference — please check the 12-digit UTR.');
    await staff.getByRole('button', { name: 'Tell the guest' }).click();
    await expect(item).toBeHidden();

    await guest.goto(payUrl, { waitUntil: 'domcontentloaded' });
    await expect(guest.getByTestId('rejected')).toContainText('No credit found');
    await guest.locator('input[name=utr]').fill(utr());
    await guest.getByRole('button', { name: 'Submit' }).click();
    await expect(guest.getByTestId('verifying')).toBeVisible();
  });

  test('staff approve; the booking confirms for the guest', async () => {
    await staff.goto(`${ADMIN}/admin/payments`, { waitUntil: 'domcontentloaded' });
    await staff.locator('li', { hasText: reference }).getByRole('button', { name: /Received — approve/ }).click();
    await expect(staff.getByText(/Approved/)).toBeVisible();
    await guest.goto(payUrl, { waitUntil: 'domcontentloaded' });
    await expect(guest.getByTestId('confirmed')).toContainText(reference);
    await expect(guest.getByTestId('confirmed')).toContainText('paid in full');
  });

  test('front desk checks the guest in to a room', async () => {
    await staff.goto(`${ADMIN}/admin/reservations?view=arrivals`, { waitUntil: 'domcontentloaded' });
    await staff.getByRole('row', { name: /Meera Iyer/ }).click();
    await expect(staff.getByRole('dialog')).toContainText(reference);
    await staff.getByRole('button', { name: 'Check in' }).click();
    await expect(staff.getByRole('dialog').getByRole('button', { name: 'Check out' })).toBeVisible();
  });

  test('guest opens their stay with an emailed private link', async () => {
    await guest.goto(`${SITE}/stay`, { waitUntil: 'domcontentloaded' });
    await guest.getByLabel('Email used for your booking').fill(email);
    await guest.getByLabel('Booking reference').fill(reference.toLowerCase());
    await guest.getByRole('button', { name: 'Email me a link' }).click();
    await expect(guest.getByText(/a private link to your stay is on its way/)).toBeVisible();
    const link = await linkFromEmail(email, /http:\/\/seabreeze\.localhost:3000\/stay\/access\?token=[\w-]+/);
    await guest.goto(link, { waitUntil: 'domcontentloaded' });
    await expect(guest.getByTestId('stay-home')).toBeVisible();
    await expect(guest.getByRole('heading', { level: 1 })).toHaveText(/Room \d+/);
    // Edge: a one-time link cannot be replayed.
    const other = await guest.context().browser()!.newContext();
    const p2 = await other.newPage();
    await p2.goto(link, { waitUntil: 'domcontentloaded' });
    await expect(p2.getByText('This link has expired')).toBeVisible();
    await other.close();
  });

  test('order in-room dining with a variant and add-on; kitchen works it', async () => {
    await guest.goto(`${SITE}/stay/dining`, { waitUntil: 'domcontentloaded' });
    await guest.getByRole('link', { name: /In-room dining/ }).click();
    await guest.getByTestId('menu-item').filter({ hasText: 'Alleppey prawn curry' }).click();
    await guest.getByLabel('Large (to share)').check();
    await guest.getByLabel('Two appams').check();
    await guest.getByRole('button', { name: 'More' }).click();
    await expect(guest.getByTestId('qty')).toHaveText('2');
    await guest.getByTestId('add-to-order').click();
    await guest.getByTestId('view-cart').click();
    await guest.getByLabel('Instructions').fill('Less spicy please');
    await guest.getByTestId('place-order').click();
    await guest.waitForURL(/\/stay\/orders\//);
    await expect(guest.getByTestId('order-status')).toContainText('Sent to the kitchen');
    await expect(guest.getByTestId('order-status')).toContainText(/Room \d+/);
    // 2 × (1100 + 500 + 100) = 3400, + 5% GST = 3570
    await expect(guest.getByTestId('order-total')).toHaveText('₹3,570');
    const orderRef = (await guest.getByText(/Order OR-/).first().textContent())!.match(/OR-[A-Z0-9]+/)![0];

    await staff.goto(`${ADMIN}/admin/dining/kitchen`, { waitUntil: 'domcontentloaded' });
    const ticket = staff.locator('article', { hasText: orderRef });
    await expect(ticket).toContainText('Less spicy please');
    for (const step of ['Accept', 'Start cooking', 'Ready']) {
      await staff.locator('article', { hasText: orderRef }).getByRole('button', { name: step }).click();
      await staff.waitForTimeout(400);
    }
    await guest.reload();
    await expect(guest.getByTestId('order-status')).toContainText('Ready — on its way');
  });

  test('ask housekeeping for towels; staff resolve it and the guest sees it done', async () => {
    await guest.goto(`${SITE}/stay/requests?cat=housekeeping`, { waitUntil: 'domcontentloaded' });
    await guest.getByRole('button', { name: /Extra towels/ }).click();
    await guest.locator('input[name=count]').fill('3');
    await guest.locator('textarea[name=description]').fill('Two bath towels and a beach towel');
    await guest.getByRole('button', { name: 'Send request' }).click();
    await expect(guest.getByTestId('request-status')).toHaveText('Received');

    await staff.goto(`${ADMIN}/admin/requests`, { waitUntil: 'domcontentloaded' });
    await staff.getByRole('row', { name: /Extra towels.*Two bath towels/ }).click();
    await staff.getByRole('dialog').getByRole('button', { name: 'Resolved' }).click();
    await expect(staff.getByText('Marked resolved')).toBeVisible();
    await guest.reload();
    await expect(guest.getByTestId('request-status')).toHaveText('Done');
  });

  test('report a plumbing issue with a photo; it becomes a maintenance ticket', async () => {
    await guest.goto(`${SITE}/stay/requests?cat=maintenance`, { waitUntil: 'domcontentloaded' });
    await guest.getByRole('button', { name: /Something needs fixing/ }).click();
    await guest.locator('select[name=category]').selectOption('plumbing');
    await guest.locator('textarea[name=description]').fill('Shower drain is blocked');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    await guest.getByTestId('photo').setInputFiles({ name: 'drain.png', mimeType: 'image/png', buffer: png });
    await guest.getByRole('button', { name: 'Send request' }).click();
    await expect(guest.getByTestId('request-detail')).toContainText('Photo attached');

    await staff.goto(`${ADMIN}/admin/maintenance`, { waitUntil: 'domcontentloaded' });
    await staff.getByRole('row', { name: /Shower drain is blocked/ }).click();
    await expect(staff.getByRole('dialog').locator('img')).toBeVisible();
  });

  test('reserve a table for tomorrow and book a kayak session charged to the room', async () => {
    await guest.goto(`${SITE}/stay/reserve`, { waitUntil: 'domcontentloaded' });
    await expect(guest.getByTestId('slots')).toBeVisible(); // hydrated, today's slots loaded
    const tomorrow = guest.waitForResponse((r) => r.url().includes(`date=${isoDay(1)}`) && r.ok());
    await guest.getByLabel('Date').fill(isoDay(1));
    await tomorrow;
    await guest.getByTestId('slots').getByRole('button', { name: '20:00' }).click();
    await guest.getByLabel('Occasion').fill('Anniversary');
    await guest.getByRole('button', { name: 'Book 20:00 for 2' }).click();
    await expect(guest.getByText(/Booked — RS-/)).toBeVisible();

    await guest.goto(`${SITE}/stay/experiences`, { waitUntil: 'domcontentloaded' });
    await guest.getByRole('button', { name: /Sunrise kayak/ }).click();
    await guest.getByTestId('exp-slots').getByRole('button').first().click();
    await guest.getByRole('button', { name: /^Book · / }).click();
    await expect(guest.getByText(/Sunrise kayak on the backwater is booked/)).toBeVisible();
  });

  test('the bill shows room, dining and experience charges', async () => {
    await guest.goto(`${SITE}/stay/bill`, { waitUntil: 'domcontentloaded' });
    const bill = guest.getByTestId('invoice');
    await expect(bill).toContainText('Garden Room');
    await expect(bill).toContainText(/Tamarind — order OR-/);
    await expect(bill).toContainText('Sunrise kayak');
  });

  test('front desk checks the guest out and issues the invoice', async () => {
    await staff.goto(`${ADMIN}/admin/reservations?view=in_house`, { waitUntil: 'domcontentloaded' });
    await staff.getByRole('row', { name: /Meera Iyer/ }).click();
    await staff.getByRole('button', { name: 'Check out' }).click();
    await expect(staff.getByText('Checked out — invoice issued')).toBeVisible();
    await guest.goto(`${SITE}/stay/bill`, { waitUntil: 'domcontentloaded' });
    await expect(guest.getByTestId('invoice')).toContainText(/Invoice INV\/\d{4}-\d{2}\/\d{5}/);
  });
});
