import { expect, test } from '@playwright/test';
import { ADMIN, bookRoom, CITY, guard, isoDay, OWNER, SITE, staffPage, uniqueEmail, utr } from './helpers';

test.describe('booking edge cases', () => {
  test('departure before arrival is refused with a clear message', async ({ page }) => {
    const done = guard(page);
    await page.goto(`${SITE}/book?checkIn=${isoDay(10)}&checkOut=${isoDay(8)}&adults=2`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('alert').filter({ hasText: 'departure' })).toContainText('departure date must be after');
    done();
  });

  test('a party too large for every room type gets no bookable rate', async ({ page }) => {
    await page.goto(`${SITE}/book?checkIn=${isoDay(20)}&checkOut=${isoDay(22)}&adults=9`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('results')).toContainText('Too small for your party');
    await expect(page.getByRole('button', { name: 'Select' })).toHaveCount(0);
  });

  test('a promo code below its minimum stay shows why it did not apply', async ({ page }) => {
    await page.goto(`${SITE}/book?checkIn=${isoDay(30)}&checkOut=${isoDay(31)}&adults=2`, { waitUntil: 'domcontentloaded' });
    await page.locator('article', { hasText: 'Garden Room' }).locator('li', { hasText: 'Room only' }).getByRole('button', { name: 'Select' }).click();
    await page.locator('input[name=coupon]').fill('MONSOON25');
    await expect(page.getByText(/needs a stay of at least 3 nights/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Continue to payment|Confirm booking/ })).toBeDisabled();
  });

  test('pay-at-property bookings confirm immediately', async ({ page }) => {
    await bookRoom(page, { email: uniqueEmail('desk'), first: 'Rahul', last: 'Nair', checkIn: isoDay(40), checkOut: isoDay(42), rate: 'Room only', pay: /Pay at the hotel/ });
    await expect(page.getByTestId('confirmed')).toContainText('settle the bill at the hotel');
  });

  test('a tampered pay link is rejected', async ({ page }) => {
    const url = await bookRoom(page, { email: uniqueEmail('tamper'), first: 'Test', last: 'Tamper', checkIn: isoDay(50), checkOut: isoDay(51), rate: 'Room only', pay: /Pay now by UPI/ });
    await page.goto(url.replace(/token=[^&]+/, 'token=forged', { waitUntil: 'domcontentloaded' }));
    await expect(page.getByText('This link isn’t working')).toBeVisible();
  });

  test('a UTR already used on another booking is refused', async ({ browser }) => {
    const ref = utr();
    const a = await (await browser.newContext()).newPage();
    await bookRoom(a, { email: uniqueEmail('dup1'), first: 'Dup', last: 'One', checkIn: isoDay(60), checkOut: isoDay(61), rate: 'Room only', pay: /Pay now by UPI/ });
    await a.locator('input[name=utr]').fill(ref);
    await a.getByRole('button', { name: 'Submit' }).click();
    await expect(a.getByTestId('verifying')).toBeVisible();
    const b = await (await browser.newContext()).newPage();
    await bookRoom(b, { email: uniqueEmail('dup2'), first: 'Dup', last: 'Two', checkIn: isoDay(62), checkOut: isoDay(63), rate: 'Room only', pay: /Pay now by UPI/ });
    await b.locator('input[name=utr]').fill(ref);
    await b.getByRole('button', { name: 'Submit' }).click();
    await expect(b.getByTestId('utr-error')).toContainText('already been used');
  });

  test('the UPI gateway path confirms automatically', async ({ page }) => {
    await bookRoom(page, { email: uniqueEmail('gw'), first: 'Gate', last: 'Way', checkIn: isoDay(70), checkOut: isoDay(72), rate: 'Room only', pay: /UPI checkout/ });
    await page.getByRole('button', { name: /test gateway/ }).click();
    await expect(page.getByTestId('confirmed')).toContainText('paid in full');
  });
});

test.describe('security & isolation from the browser', () => {
  test('injected markup in a guest message renders as text for staff', async ({ browser }) => {
    const g = await (await browser.newContext()).newPage();
    await g.goto(`${SITE}/contact`, { waitUntil: 'domcontentloaded' });
    const payload = '<img src=x onerror="alert(1)">Hello from <b>Priya</b>';
    await g.getByLabel('Name').fill('Priya Test');
    await g.getByLabel('Email').fill(uniqueEmail('xss'));
    await g.getByLabel('Message').fill(payload);
    await expect(g.getByRole('button', { name: 'Send message' })).toBeEnabled(); // hydrated
    await g.getByRole('button', { name: 'Send message' }).click();
    await expect(g.getByText('Thank you')).toBeVisible();
    const staff = await staffPage(browser);
    const done = guard(staff);
    await staff.goto(`${ADMIN}/admin/messages`, { waitUntil: 'domcontentloaded' });
    await staff.getByRole('button', { name: /Priya Test/ }).click();
    await expect(staff.getByText('Hello from Priya', { exact: false })).toBeVisible();
    await expect(staff.locator('main img[src="x"]')).toHaveCount(0);
    done();
  });

  test('guest routes require sign-in', async ({ page }) => {
    await page.goto(`${SITE}/stay/bill`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('guest-signin')).toBeVisible();
    const r = await page.request.get(`${SITE}/api/v1/portal/home`);
    expect(r.status()).toBe(401);
  });

  test('admin pages bounce to sign-in without a session', async ({ page }) => {
    await page.goto(`${ADMIN}/admin/payments`, { waitUntil: 'domcontentloaded' });
    await page.waitForURL(/\/admin\/login/, { waitUntil: 'commit' });
  });

  test('wrong password is rejected without revealing the account', async ({ page }) => {
    await page.goto(`${ADMIN}/admin/login`, { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Email').fill(OWNER.email);
    await page.getByLabel('Password').fill('not-the-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert').filter({ hasText: /\w/ })).toHaveText('Incorrect email or password');
  });

  test('a property without the Restaurant module shows no dining anywhere', async ({ page }) => {
    await page.goto(CITY, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('header').getByRole('link', { name: 'Dining' })).toHaveCount(0);
    expect((await page.goto(`${CITY}/dining`, { waitUntil: 'domcontentloaded' }))!.status()).toBe(404);
    expect((await page.request.get(`${CITY}/api/v1/public/restaurants`)).status()).toBe(403);
  });

  test('unknown pages and unknown hosts are 404s', async ({ page }) => {
    expect((await page.goto(`${SITE}/no-such-page`, { waitUntil: 'domcontentloaded' }))!.status()).toBe(404);
    await expect(page.getByText('Page not found')).toBeVisible();
    expect((await page.goto('http://nobody-here.localhost:3000/', { waitUntil: 'domcontentloaded' }))!.status()).toBe(404);
  });
});

test.describe('operations edge cases', () => {
  test('sold-out items cannot be ordered, and come back when restored', async ({ browser }) => {
    const staff = await staffPage(browser);
    await staff.goto(`${ADMIN}/admin/dining/kitchen`, { waitUntil: 'domcontentloaded' });
    await staff.getByRole('button', { name: 'Sold out items' }).click();
    const row = staff.locator('li', { hasText: 'Kerala sadya (lunch)' });
    await row.getByRole('button', { name: 'Sold out' }).click();
    await expect(row.getByRole('button', { name: 'Back on' })).toBeVisible();

    const g = await (await browser.newContext()).newPage();
    await g.goto(`${SITE}/dining`, { waitUntil: 'domcontentloaded' });
    await g.getByRole('button', { name: 'From the garden' }).click();
    await expect(g.locator('li', { hasText: 'Kerala sadya' })).toHaveClass(/opacity-50/);

    await row.getByRole('button', { name: 'Back on' }).click();
    await expect(row.getByRole('button', { name: 'Sold out' })).toBeVisible();
  });

  test('restaurant booking widget on the public site books a table', async ({ page }) => {
    await page.goto(`${SITE}/dining#reserve`, { waitUntil: 'domcontentloaded' });
    const w = page.locator('#reserve');
    await expect(w.getByRole('button', { name: '19:30' }).first()).toBeVisible(); // hydrated and slots loaded
    await w.getByLabel('Date').fill(isoDay(3));
    await expect(w.getByRole('button', { name: '19:30' }).first()).toBeEnabled();
    await w.getByRole('button', { name: '19:30' }).first().click();
    await w.getByLabel('Name').fill('Walk In');
    await w.getByLabel('Email').fill(uniqueEmail('table'));
    await w.getByLabel('Phone').fill('+91 90000 00000');
    await w.getByRole('button', { name: /Book 19:30 for 2/ }).click();
    await expect(page.getByText('Your table is booked')).toBeVisible();
  });
});
