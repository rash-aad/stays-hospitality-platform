import { expect, test } from '@playwright/test';
import { ADMIN, guard, staffPage } from './helpers';

test('owner turns on loyalty and review links, then drafts a campaign and previews its audience', async ({ browser }) => {
  const page = await staffPage(browser);
  const done = guard(page);
  await page.goto(`${ADMIN}/admin/settings/loyalty`, { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Guests earn points on their stays').check();
  await page.getByRole('button', { name: 'Save' }).first().click();
  await expect(page.getByText('Loyalty saved')).toBeVisible();
  await page.getByLabel('Google review link').fill('https://g.page/r/seabreeze-cherai/review');
  await page.getByRole('button', { name: 'Save' }).nth(1).click();
  await expect(page.getByText('Review links saved')).toBeVisible();

  await page.goto(`${ADMIN}/admin/campaigns`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'New campaign' }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Name (internal)').fill('Monsoon welcome back');
  await d.getByLabel('Subject').fill('{{firstName}}, the monsoon is beautiful here');
  await d.getByLabel(/^Message/).fill('Hello {{firstName}},\n\nStay three nights, pay for two, all of July.');
  await expect(page.getByTestId('audience')).toContainText('opted-in guest');
  await d.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft saved')).toBeVisible();
  await d.getByRole('button', { name: 'Send test to me' }).click();
  await expect(page.getByText('Test sent to your email')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('campaigns')).toContainText('Monsoon welcome back');
  done();
});

test('an in-house guest sees their points and pays part of the bill with them', async ({ page, request }) => {
  const { linkFromEmail, OWNER, SITE } = await import('./helpers');
  const done = guard(page);
  const login = await (await request.post(`${ADMIN}/api/v1/auth/staff/login`, { data: OWNER })).json();
  const auth = { authorization: `Bearer ${login.accessToken}` };
  await request.put(`${ADMIN}/api/v1/admin/loyalty-settings`, { headers: auth, data: { enabled: true, earnPerHundred: 10, pointValue: 25, minRedeem: 200, tiers: [{ name: 'Member', minNights: 0, bonusPct: 0 }, { name: 'Silver', minNights: 5, bonusPct: 10 }] } });
  const b = (await (await request.get(`${ADMIN}/api/v1/admin/bookings?view=in_house&pageSize=5`, { headers: auth })).json()).data.at(-1);
  const guestId = (await (await request.get(`${ADMIN}/api/v1/admin/bookings/${b.id}`, { headers: auth })).json()).data.guest.id;
  expect((await request.post(`${ADMIN}/api/v1/admin/guests/${guestId}/loyalty/adjust`, { headers: auth, data: { points: 400, note: 'Welcome gift' } })).status()).toBe(200);

  await request.post(`${SITE}/api/v1/guest-auth/access-link`, { data: { email: b.guestEmail, reference: b.reference } });
  const link = await linkFromEmail(b.guestEmail, /http:\/\/seabreeze\.localhost:3000\/stay\/access\?token=[\w-]+/);
  await page.goto(`${link}&next=/stay/more`, { waitUntil: 'domcontentloaded' });
  const pts = page.getByTestId('points');
  await expect(pts).toContainText('Worth ₹100');
  await page.getByRole('button', { name: 'Use points' }).first().click();
  await page.getByTestId('redeem-form').getByLabel(/Points to use/).fill('200');
  await page.getByTestId('redeem-form').getByRole('button', { name: 'Use' }).click();
  await expect(page.getByText('₹50 paid with points.')).toBeVisible();
  await expect(pts).toContainText('Worth ₹50');
  done();
});
