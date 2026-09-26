import { expect, request, test, type Page } from '@playwright/test';
import { ADMIN, CITY, linkFromEmail, OWNER, PLATFORM, SITE, staffPage } from './helpers';

/**
 * Smoke sweep: open every screen for every role and fail on crashes, server errors or error banners.
 * Screenshots land in test-results/sweep for a visual once-over.
 */
const ADMIN_PAGES = [
  '/admin', '/admin/reservations', '/admin/tape-chart', '/admin/cash-drawer', '/admin/night-audit', '/admin/revenue', '/admin/calendar', '/admin/guests', '/admin/payments', '/admin/messages', '/admin/feedback', '/admin/events',
  '/admin/dining/reservations', '/admin/dining/kitchen', '/admin/dining/menus', '/admin/requests', '/admin/housekeeping', '/admin/maintenance', '/admin/experiences',
  '/admin/site', '/admin/guide', '/admin/reports',
  '/admin/settings/property', '/admin/settings/rates', '/admin/settings/payments', '/admin/settings/billing', '/admin/settings/channels', '/admin/settings/modules',
  '/admin/settings/staff', '/admin/settings/requests', '/admin/settings/notifications', '/admin/settings/integrations', '/admin/settings/security', '/admin/settings/audit', '/admin/account',
];
const SITE_PAGES = ['/', '/rooms', '/dining', '/experiences', '/contact', '/book'];
const STAY_PAGES = ['/stay', '/stay/dining', '/stay/requests', '/stay/bill', '/stay/more', '/stay/guide', '/stay/messages', '/stay/notifications', '/stay/experiences', '/stay/reserve'];

function watch(page: Page) {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`pageerror at ${page.url()}: ${e.message}\n${(e.stack ?? "").split("\n").slice(0, 4).join("\n")}`));
  page.on('response', (r) => { if (r.status() >= 500) problems.push(`${r.status()} ${r.url()}`); });
  return problems;
}

async function sweep(page: Page, base: string, paths: string[], name: string, problems: string[]) {
  for (const path of paths) {
    await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('h1').first(), `${path} has a heading`).toBeVisible();
    await page.waitForLoadState('networkidle').catch(() => {});
    const banners = await page.locator('.bg-bad-soft.text-bad').allTextContents();
    if (banners.length) problems.push(`${path}: ${banners.join(' | ')}`);
    await page.screenshot({ path: `test-results/sweep/${name}${path.replaceAll('/', '_') || '_home'}.png`, fullPage: true });
  }
}

test('every staff screen opens cleanly', async ({ browser }) => {
  test.setTimeout(300_000);
  const page = await staffPage(browser);
  const problems = watch(page);
  await sweep(page, ADMIN, ADMIN_PAGES, 'admin', problems);
  // Full-screen tools.
  await page.goto(`${ADMIN}/admin/site`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('link', { name: 'Edit', exact: true }).first().click();
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.screenshot({ path: 'test-results/sweep/admin_site-editor.png' });
  expect(problems, problems.join('\n')).toEqual([]);
});

test('platform console opens cleanly', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const problems = watch(page);
  await page.goto(`${PLATFORM}/platform/login`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  await page.getByLabel('Email').fill('admin@bookez.in');
  await page.getByLabel('Password').fill('Bookez!Admin2026');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/platform$/);
  await sweep(page, PLATFORM, ['/platform', '/platform/account'], 'platform', problems);
  expect(problems, problems.join('\n')).toEqual([]);
});

test('both public websites open cleanly', async ({ page }) => {
  const problems = watch(page);
  await sweep(page, SITE, SITE_PAGES, 'site-seabreeze', problems);
  await sweep(page, CITY, ['/', '/rooms', '/book'], 'site-printworks', problems);
  expect(problems, problems.join('\n')).toEqual([]);
});

test('every guest portal screen opens cleanly, including the new ones', async ({ page }) => {
  test.setTimeout(240_000);
  const api = await request.newContext({ baseURL: ADMIN });
  const login = await (await api.post('/api/v1/auth/staff/login', { data: OWNER })).json();
  const auth = { authorization: `Bearer ${login.accessToken}` };
  const list = await (await api.get('/api/v1/admin/bookings?view=in_house&pageSize=1', { headers: auth })).json();
  const b = list.data[0];
  await api.post(`${SITE}/api/v1/guest-auth/access-link`, { data: { email: b.guestEmail, reference: b.reference } });
  const link = await linkFromEmail(b.guestEmail, /http:\/\/seabreeze\.localhost:3000\/stay\/access\?token=[\w-]+/);
  await page.goto(link, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('stay-home')).toBeVisible();

  const problems = watch(page);
  await sweep(page, SITE, [...STAY_PAGES, `/stay/feedback/${b.id}`], 'stay', problems);
  // Invoice preview from the bill.
  await page.goto(`${SITE}/stay/bill`, { waitUntil: 'domcontentloaded' });
  await page.getByTestId('open-invoice').click();
  await expect(page.getByTestId('tax-invoice')).toBeVisible();
  await page.screenshot({ path: 'test-results/sweep/stay_invoice.png', fullPage: true });
  expect(problems, problems.join('\n')).toEqual([]);
  await api.dispose();
});

test('guest checks in online and prices a date change; the desk sees the details', async ({ browser }) => {
  test.setTimeout(180_000);
  const { bookRoom, isoDay, uniqueEmail } = await import('./helpers');
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const problems = watch(page);
  const email = uniqueEmail('precheck');
  await bookRoom(page, { email, first: 'Nikhil', last: 'Kapoor', checkIn: isoDay(30), checkOut: isoDay(32), rate: 'Room only', pay: /Pay at the hotel/ });

  const api = await request.newContext({ baseURL: ADMIN });
  const login = await (await api.post('/api/v1/auth/staff/login', { data: OWNER })).json();
  const b = (await (await api.get(`/api/v1/admin/bookings?q=${encodeURIComponent(email)}`, { headers: { authorization: `Bearer ${login.accessToken}` } })).json()).data[0];
  await api.post(`${SITE}/api/v1/guest-auth/access-link`, { data: { email, reference: b.reference } });
  const link = await linkFromEmail(email, /http:\/\/seabreeze\.localhost:3000\/stay\/access\?token=[\w-]+/);
  // The emailed link can deep-link straight to online check-in.
  await page.goto(`${link}&next=/stay/checkin/${b.id}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('precheckin-form')).toBeVisible();
  await page.getByLabel('Arriving around').fill('15:30');
  await page.getByLabel('Type').selectOption('passport');
  await page.getByLabel('Last 4 characters').fill('Z9K2');
  await page.getByRole('button', { name: 'Complete online check-in' }).isDisabled();
  await page.getByLabel(/I confirm these details/).check();
  await page.getByRole('button', { name: 'Complete online check-in' }).click();
  await expect(page.getByText('you’re checked in online')).toBeVisible();
  await page.screenshot({ path: 'test-results/sweep/stay_checkin.png', fullPage: true });

  // Change dates: price first, nothing committed.
  await page.goto(`${SITE}/stay/change/${b.id}`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Check-out').fill(isoDay(33));
  await page.getByRole('button', { name: 'Check availability & price' }).click();
  await expect(page.getByTestId('change-quote')).toContainText('Additional');
  await page.screenshot({ path: 'test-results/sweep/stay_change.png', fullPage: true });
  await page.getByRole('button', { name: 'Confirm new dates' }).click();
  await expect(page.getByRole('heading', { name: 'Dates changed' })).toBeVisible();

  const staff = await staffPage(browser);
  await staff.goto(`${ADMIN}/admin/reservations`, { waitUntil: 'domcontentloaded' });
  await staff.getByPlaceholder('Guest, reference, phone').fill(b.reference);
  await staff.getByRole('row', { name: /Nikhil Kapoor/ }).click();
  await expect(staff.getByTestId('precheckin-details')).toContainText('····Z9K2');
  await staff.screenshot({ path: 'test-results/sweep/admin_precheckin.png' });
  expect(problems, problems.join('\n')).toEqual([]);
  await api.dispose();
});
