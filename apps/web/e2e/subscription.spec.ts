import { expect, test, type Page } from '@playwright/test';
import { ADMIN, guard, PLATFORM } from './helpers';

const OWNER = { email: 'owner@printworks.example', password: 'Printworks!2026' };

async function signIn(page: Page, url: string, email: string, password: string, landing: RegExp) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(landing);
}

test('super admin prices a property; the owner pays yearly by UPI; the payment is verified and the tax invoice is downloadable', async ({ browser }) => {
  // 1. Super admin sets ₹2,999/month, ₹29,990/year and 30 free days.
  const consoleCtx = await browser.newContext();
  const admin = await consoleCtx.newPage();
  const doneA = guard(admin);
  await signIn(admin, `${PLATFORM}/platform/login`, 'admin@bookez.in', 'Bookez!Admin2026', /\/platform$/);
  await admin.getByRole('link', { name: 'The Printworks' }).click();
  await admin.getByLabel('Free days').fill('30');
  await admin.getByLabel(/Monthly fee/).fill('2999');
  await admin.getByLabel(/Yearly fee/).fill('29990');
  await admin.getByRole('button', { name: 'Save pricing' }).click();
  await expect(admin.getByText(/Subscription saved/)).toBeVisible();

  // 2. The owner opens Subscription, picks Yearly, sees the QR and total, submits a UTR.
  const ownerCtx = await browser.newContext();
  const owner = await ownerCtx.newPage();
  const doneO = guard(owner);
  await signIn(owner, `${ADMIN}/admin/login`, OWNER.email, OWNER.password, /\/admin$/);
  await owner.goto(`${ADMIN}/admin/settings/subscription`, { waitUntil: 'domcontentloaded' });
  await expect(owner.getByTestId('sub-status-line')).toContainText('Free trial');
  await owner.getByText('Yearly', { exact: true }).click();
  await expect(owner.getByText('Save ₹5,998 vs paying monthly')).toBeVisible();
  await owner.getByRole('button', { name: /^Pay ₹35,388.2/ }).click();
  const panel = owner.getByTestId('pay-panel');
  await expect(panel.getByRole('img', { name: /UPI QR code/ })).toBeVisible();
  await expect(owner.getByTestId('pay-total')).toHaveText('₹35,388.20');
  await expect(panel).toContainText('bookez@okhdfcbank');
  const utr = `8${String(Date.now()).slice(-11)}`;
  await owner.getByLabel(/UPI reference/).fill(utr);
  await owner.getByRole('button', { name: 'I’ve paid — submit' }).click();
  await expect(owner.getByTestId('sub-pending')).toContainText('Payment received — we confirm payments within 12 hours');
  await owner.reload({ waitUntil: 'domcontentloaded' });
  await expect(owner.getByTestId('sub-pending')).toBeVisible();
  await expect(owner.getByTestId('subscription-banner')).toContainText('Payment under verification');

  // 3. Super admin approves it from the queue.
  await admin.goto(`${PLATFORM}/platform/payments`, { waitUntil: 'domcontentloaded' });
  const row = admin.getByTestId('payments-queue').getByRole('row', { name: new RegExp(utr) });
  await expect(row).toContainText('₹35,388.20');
  await row.getByRole('button', { name: 'Approve' }).click();
  await expect(admin.getByText('Nothing waiting')).toBeVisible();

  // 4. The owner is active for a year and downloads the GST tax invoice.
  await owner.reload({ waitUntil: 'domcontentloaded' });
  const nextYear = String(new Date().getFullYear() + 1);
  await expect(owner.getByTestId('sub-status-line')).toContainText('Active — paid until');
  await expect(owner.getByTestId('sub-status-line')).toContainText(nextYear);
  const [doc] = await Promise.all([ownerCtx.waitForEvent('page'), owner.getByTestId('sub-invoices').getByRole('link', { name: 'Tax invoice' }).click()]);
  await doc.waitForLoadState('domcontentloaded');
  await expect(doc.getByTestId('tax-invoice')).toContainText('TAX INVOICE', { ignoreCase: true });
  await expect(doc.getByTestId('tax-invoice-total')).toHaveText('₹35,388.20');
  await expect(doc.getByTestId('tax-invoice')).toContainText('bookEZ Technologies Private Limited');
  doneA();
  doneO();
});
