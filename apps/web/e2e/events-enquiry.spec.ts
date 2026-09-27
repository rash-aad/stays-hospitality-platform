import { expect, test } from '@playwright/test';
import { ADMIN, guard, isoDay, SITE, staffPage } from './helpers';

test('owner builds a weddings page with a library photo; a visitor’s enquiry lands in Events', async ({ browser }) => {
  const staff = await staffPage(browser);
  const done = guard(staff);
  const stamp = Date.now().toString(36);
  const photo = `https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=1200&q=70&v=${stamp}`;
  const alt = `Lawn set for a wedding ${stamp}`;

  // A described photo in the media library.
  await staff.goto(`${ADMIN}/admin/site`, { waitUntil: 'domcontentloaded' });
  await staff.getByRole('tab', { name: 'Media' }).click();
  await staff.getByPlaceholder('Or paste an https:// image address').fill(photo);
  await staff.getByRole('button', { name: 'Add', exact: true }).click();
  const item = staff.locator('li', { has: staff.locator(`img[src="${photo}"]`) });
  await item.getByPlaceholder('Describe the photo').fill(alt);
  await item.getByPlaceholder('Describe the photo').blur();
  await expect(staff.getByText('Saved')).toBeVisible();

  // A new page with the events enquiry section, its photo picked from the library.
  await staff.getByRole('tab', { name: 'Pages' }).click();
  await staff.getByRole('button', { name: 'New page' }).click();
  await staff.getByRole('dialog').getByLabel('Title').fill(`Weddings ${stamp}`);
  const slug = `weddings-${stamp}`;
  await staff.getByRole('button', { name: 'Create and edit' }).click();
  await expect(staff.getByTestId('canvas')).toBeVisible();
  await staff.getByRole('button', { name: 'Add your first section' }).click();
  await staff.getByRole('button', { name: 'Events enquiry' }).click();
  const inspector = staff.getByTestId('inspector');
  await inspector.getByRole('button', { name: 'Choose from media library' }).click();
  await inspector.getByRole('list', { name: 'Media library' }).getByRole('button', { name: alt }).click();
  await expect(inspector.getByPlaceholder('https://… image URL')).toHaveValue(photo);
  await expect(inspector.getByPlaceholder('Describe the photo (alt text)')).toHaveValue(alt);
  await expect(staff.getByTestId('save-state')).toHaveText(/^Saved/, { timeout: 15_000 });
  await staff.getByRole('button', { name: 'Publish' }).click();
  await expect(staff.getByText('Published — live on your website')).toBeVisible();

  // A visitor sends an enquiry.
  const guest = await (await browser.newContext()).newPage();
  const g = guard(guest);
  await expect.poll(async () => { await guest.goto(`${SITE}/${slug}`, { waitUntil: 'domcontentloaded' }); return guest.getByTestId('event-enquiry').count(); }, { timeout: 20_000 }).toBe(1);
  await expect(guest.getByRole('heading', { name: 'Weddings & celebrations' })).toBeVisible();
  await expect(guest.getByRole('img', { name: alt })).toBeVisible();
  const form = guest.getByTestId('event-enquiry');
  const name = `Meera Pillai ${stamp}`;
  await form.getByLabel('Name').fill(name);
  await form.getByLabel('Email').fill(`meera.${stamp}@example.com`);
  await form.getByLabel('Phone').fill('+91 98470 12345');
  await form.getByLabel('Occasion').selectOption('wedding');
  await form.getByLabel('Date (if you know it)').fill(isoDay(150));
  await form.getByLabel('Number of guests').fill('180');
  await form.getByLabel('Tell us about it').fill('A beach wedding with a sangeet the night before.');
  await form.getByRole('button', { name: 'Send enquiry' }).click();
  await expect(guest.getByText('Thank you — we’ll be in touch.')).toBeVisible();
  await expect(guest.getByText(/Your enquiry reference is EV-/)).toBeVisible();
  g();

  // It reaches the events team.
  await staff.goto(`${ADMIN}/admin/events`, { waitUntil: 'domcontentloaded' });
  await expect(staff.getByText(name)).toBeVisible();

  // Tidy up so the rest of the suite sees the seeded site.
  await staff.goto(`${ADMIN}/admin/site`, { waitUntil: 'domcontentloaded' });
  await staff.getByRole('row', { name: new RegExp(`Weddings ${stamp}`) }).getByRole('button', { name: 'Delete' }).click();
  await staff.getByRole('button', { name: 'Delete page' }).click();
  await expect(staff.getByText('Page deleted')).toBeVisible();
  done();
});
