import { expect, test, type Page } from '@playwright/test';
import { ADMIN, guard, linkFromEmail, OWNER, PLATFORM, SITE, staffPage, uniqueEmail } from './helpers';

const ADMIN_PAGES = [
  '/admin', '/admin/reservations', '/admin/calendar', '/admin/guests', '/admin/payments', '/admin/messages', '/admin/events',
  '/admin/dining/reservations', '/admin/dining/kitchen', '/admin/dining/menus', '/admin/requests', '/admin/housekeeping', '/admin/maintenance',
  '/admin/experiences', '/admin/site', '/admin/guide', '/admin/reports', '/admin/settings/property', '/admin/settings/rates',
  '/admin/settings/payments', '/admin/settings/modules', '/admin/settings/staff', '/admin/settings/requests', '/admin/settings/notifications',
  '/admin/settings/integrations', '/admin/settings/audit',
];

test('owner can open every admin screen without errors', async ({ browser }) => {
  const page = await staffPage(browser);
  const done = guard(page);
  for (const path of ADMIN_PAGES) {
    await page.goto(`${ADMIN}${path}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 }), path).toBeVisible();
    await expect(page.getByText('Loading workspace…')).toBeHidden();
    await expect(page.locator('.bg-bad-soft'), `${path} shows an error`).toHaveCount(0);
  }
  done();
});

test.describe.serial('website builder', () => {
  let staff: Page;
  test.beforeAll(async ({ browser }) => { staff = await staffPage(browser); });

  test('apply a template, edit inline, reorder with undo, publish, and see it live', async () => {
    const done = guard(staff);
    await staff.goto(`${ADMIN}/admin/site`, { waitUntil: 'domcontentloaded' });
    await staff.getByRole('tab', { name: 'Templates' }).click();
    await expect(staff.getByTestId('templates').locator('li')).toHaveCount(10);
    await staff.getByRole('button', { name: /Hill Station/ }).click();
    await staff.getByRole('button', { name: 'Apply template' }).click();
    await expect(staff.getByText(/Hill Station applied/)).toBeVisible();

    await staff.getByRole('tab', { name: 'Pages' }).click();
    await staff.getByRole('row', { name: /Home/ }).getByRole('link', { name: 'Edit' }).click();
    await expect(staff.getByTestId('canvas')).toBeVisible();
    const heading = staff.getByTestId('canvas').locator('h1[contenteditable]').first();
    await expect(heading).toContainText('Above the clouds');
    await heading.click();
    await staff.keyboard.press('ControlOrMeta+a');
    await staff.keyboard.type('Mist, pine and a fire that is always lit');
    await staff.getByTestId('outline').click(); // blur commits the text
    await expect(staff.getByTestId('save-state')).toHaveText(/^Saved/, { timeout: 15_000 }); // a real autosave, not the initial state

    // Keyboard drag: move the second section above the first, then undo.
    const outline = staff.getByTestId('outline').locator('li');
    const second = await outline.nth(1).innerText();
    await outline.nth(1).getByRole('button', { name: /^Reorder/ }).focus();
    await staff.keyboard.press('Space'); await staff.waitForTimeout(150);
    await staff.keyboard.press('ArrowUp'); await staff.waitForTimeout(250);
    await staff.keyboard.press('Space');
    await expect(staff.getByTestId('save-state')).toHaveText(/Unsaved|Saving|^Saved/); // the drop committed a change
    await expect(outline.first()).toContainText(second.split('\n')[0]!);
    await staff.getByRole('button', { name: 'Undo' }).click();
    await expect(outline.nth(1)).toContainText(second.split('\n')[0]!);
    await expect(heading).toHaveText('Mist, pine and a fire that is always lit'); // undo only reverted the move

    // Inspector edits: change the hero button label through the schema-driven form.
    await staff.getByTestId('canvas').locator('section').first().click({ position: { x: 5, y: 200 } });
    await expect(staff.getByTestId('inspector')).toContainText('Hero');
    await expect(staff.getByTestId('save-state')).toHaveText(/Saved|All changes saved/, { timeout: 15_000 });
    await staff.getByRole('button', { name: 'Publish' }).click();
    await expect(staff.getByText('Published — live on your website')).toBeVisible();

    // Publishing purges the site cache asynchronously — poll the live page.
    const site = await staff.context().newPage();
    await expect.poll(async () => { await site.goto(SITE, { waitUntil: 'domcontentloaded' }); return site.getByRole('heading', { level: 1 }).innerText(); }, { timeout: 20_000 }).toBe('Mist, pine and a fire that is always lit');
    await site.close();
    done();
  });

  test('restore the coastal template so the rest of the suite sees the seeded site', async () => {
    await staff.goto(`${ADMIN}/admin/site`, { waitUntil: 'domcontentloaded' });
    await staff.getByRole('tab', { name: 'Templates' }).click();
    await staff.getByRole('button', { name: /^Coastal/ }).click();
    await staff.getByRole('button', { name: 'Apply template' }).click();
    await expect(staff.getByText(/Coastal applied/)).toBeVisible();
    await staff.getByRole('tab', { name: 'Pages' }).click();
    await staff.getByRole('button', { name: 'Publish all changes' }).click();
    await expect(staff.getByText('Everything is live')).toBeVisible();
    const site = await staff.context().newPage();
    await expect.poll(async () => { await site.goto(SITE, { waitUntil: 'domcontentloaded' }); return site.getByRole('heading', { level: 1 }).innerText(); }, { timeout: 20_000 }).toContain('Wake to the tide');
  });
});

test('UPI settings validate the UPI ID and save', async ({ browser }) => {
  const staff = await staffPage(browser);
  await staff.goto(`${ADMIN}/admin/settings/payments`, { waitUntil: 'domcontentloaded' });
  const vpa = staff.getByLabel('UPI ID (VPA)');
  await expect(vpa).toHaveValue('seabreezecherai@okhdfcbank');
  await vpa.fill('not a upi id');
  await staff.getByRole('button', { name: 'Save' }).click();
  await expect(staff.getByText(/UPI ID like/)).toBeVisible();
  await vpa.fill('seabreezecherai@okhdfcbank');
  await staff.getByLabel('Payee name').fill('Seabreeze Cherai Resorts');
  await staff.getByRole('button', { name: 'Save' }).click();
  await expect(staff.getByText('Payment settings saved')).toBeVisible();
});

test('switching a module off hides it for staff and the API refuses it', async ({ browser }) => {
  const staff = await staffPage(browser);
  await staff.goto(`${ADMIN}/admin/settings/modules`, { waitUntil: 'domcontentloaded' });
  await staff.getByRole('switch', { name: 'Events & Banquets' }).uncheck();
  await expect(staff.getByText('Events & Banquets off')).toBeVisible();
  await staff.reload();
  await expect(staff.getByRole('link', { name: 'Events & banquets' })).toHaveCount(0);
  expect((await staff.request.post(`${SITE}/api/v1/public/events/inquiry`, { data: { contactName: 'X Y', email: 'x@example.com', eventType: 'wedding' } })).status()).toBe(403);
  await staff.getByRole('switch', { name: 'Events & Banquets' }).check();
  await expect(staff.getByText('Events & Banquets on')).toBeVisible();
  await staff.reload();
  await expect(staff.getByRole('link', { name: 'Events & banquets' })).toBeVisible();
});

test('invited kitchen staff set a password and see only their tools', async ({ browser }) => {
  const owner = await staffPage(browser);
  const email = uniqueEmail('chef');
  await owner.goto(`${ADMIN}/admin/settings/staff`, { waitUntil: 'domcontentloaded' });
  await owner.getByRole('button', { name: 'Invite staff' }).click();
  const drawer = owner.getByRole('dialog');
  await drawer.getByLabel('Name').fill('Anil Kitchen');
  await drawer.getByLabel('Email').fill(email);
  await drawer.getByRole('checkbox', { name: 'Kitchen' }).check();
  await drawer.getByRole('button', { name: 'Send invite' }).click();
  await expect(owner.getByText('Invitation sent')).toBeVisible();

  const link = await linkFromEmail(email, /http:\/\/localhost:3000\/admin\/accept-invite\?token=[\w-]+/);
  const ctx = await browser.newContext();
  const chef = await ctx.newPage();
  const done = guard(chef);
  await chef.goto(link, { waitUntil: 'domcontentloaded' });
  await chef.getByLabel('New password').fill('KitchenPass2026');
  await chef.getByLabel('Repeat password').fill('KitchenPass2026');
  await chef.getByRole('button', { name: 'Save password' }).click();
  await chef.waitForURL(/\/admin\/login/);
  await chef.getByLabel('Email').fill(email);
  await chef.getByLabel('Password').fill('KitchenPass2026');
  await chef.getByRole('button', { name: 'Sign in' }).click();
  const nav = chef.locator('aside nav');
  await expect(nav.getByRole('link', { name: 'Kitchen' })).toBeVisible();
  for (const hidden of ['Reservations', 'Payments', 'Guests', 'Website', 'Reports', 'Staff & roles']) await expect(nav.getByRole('link', { name: hidden, exact: true })).toHaveCount(0);
  // Typing a URL doesn't bypass permissions: the server refuses.
  await chef.goto(`${ADMIN}/admin/payments`, { waitUntil: 'domcontentloaded' });
  await expect(chef.getByText(/Missing permission: payments.read/)).toBeVisible();
  done();
});

test('platform admin onboards a property whose site is live, then suspends it', async ({ browser }) => {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const done = guard(p);
  await p.goto(`${PLATFORM}/`, { waitUntil: 'domcontentloaded' });
  await p.waitForURL(/\/platform\/login$/);
  await expect(p.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  await p.getByLabel('Email').fill('admin@bookez.in');
  await p.getByLabel('Password').fill('Bookez!Admin2026');
  await p.getByRole('button', { name: 'Sign in' }).click();
  await p.waitForURL(/\/platform$/);
  const slug = `hills${Date.now().toString(36)}`;
  await p.getByRole('button', { name: 'Onboard a property' }).click();
  const d = p.getByRole('dialog');
  await d.getByLabel('Property name').fill('Misty Hills Lodge');
  await d.getByLabel('Subdomain').fill(slug);
  await d.getByLabel('Website template').selectOption('hill_station');
  await d.getByLabel('Owner name').fill('Asha Menon');
  await d.getByLabel('Owner email').fill(uniqueEmail('owner'));
  await d.getByRole('button', { name: 'Create property' }).click();
  await expect(p.getByText('Property created — owner invited by email')).toBeVisible();
  await p.getByRole('link', { name: 'Misty Hills Lodge' }).first().click();

  const site = await ctx.newPage();
  await site.goto(`http://${slug}.localhost:3000/`, { waitUntil: 'domcontentloaded' });
  await expect(site.getByRole('heading', { level: 1 })).toContainText('Above the clouds');

  await p.getByRole('button', { name: 'Suspend' }).click();
  await expect(p.getByText(/Tenant suspended/)).toBeVisible();
  expect((await site.request.get(`http://${slug}.localhost:3000/api/v1/public/site`)).status()).toBe(404);
  await expect.poll(async () => (await site.request.get(`http://${slug}.localhost:3000/`)).status()).toBe(404);
  await p.getByRole('button', { name: 'Reactivate' }).click();
  await expect(p.getByText('Tenant reactivated')).toBeVisible();
  done();
});

test('the Super Admin console lives only on its own origin and admits only platform accounts', async ({ browser, request }) => {
  // Not reachable from the hotel admin origin — pages or APIs.
  expect((await request.get(`${ADMIN}/platform`)).status()).toBe(404);
  expect((await request.get(`${ADMIN}/api/v1/platform/tenants`)).status()).toBe(404);
  // The console origin serves nothing else.
  expect((await request.get(`${PLATFORM}/admin/login`)).status()).toBe(404);
  expect((await request.get(`${PLATFORM}/api/v1/public/site`)).status()).toBe(404);

  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(`${PLATFORM}/platform/login`, { waitUntil: 'domcontentloaded' });
  await expect(p.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  await p.getByLabel('Email').fill(OWNER.email);
  await p.getByLabel('Password').fill(OWNER.password);
  await p.getByRole('button', { name: 'Sign in' }).click();
  await expect(p.getByText('This console is for platform administrators')).toBeVisible();

  // And the hotel admin sign-in points platform admins to the console.
  await p.goto(`${ADMIN}/admin/login`, { waitUntil: 'domcontentloaded' });
  await expect(p.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  await p.getByLabel('Email').fill('admin@bookez.in');
  await p.getByLabel('Password').fill('Bookez!Admin2026');
  await p.getByRole('button', { name: 'Sign in' }).click();
  await expect(p.getByText(`Platform administrators sign in at ${PLATFORM}`)).toBeVisible();
  await ctx.close();
});
