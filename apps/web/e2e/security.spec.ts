import { expect, test } from '@playwright/test';
import { ADMIN, CITY, guard, totpCode } from './helpers';

// Uses the city hotel's owner so the rest of the suite (which signs in as the resort owner) is unaffected.
const OWNER = { email: 'owner@printworks.example', password: 'Printworks!2026' };

test('owner turns on two-step sign-in, signs in with a code, sees their devices, then turns it off', async ({ page }) => {
  const done = guard(page);
  await page.goto(`${ADMIN}/admin/login`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  await page.getByLabel('Email').fill(OWNER.email);
  await page.getByLabel('Password').fill(OWNER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })).toBeVisible();

  await page.getByRole('link', { name: 'Kabir Desai' }).click();
  await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
  await page.getByRole('button', { name: 'Set up', exact: true }).click();
  await page.getByRole('button', { name: 'Set up two-step sign-in' }).click();
  const secret = (await page.getByTestId('mfa-secret').textContent())!.trim();
  await page.getByLabel('6-digit code').fill(totpCode(secret));
  await page.getByRole('button', { name: 'Turn on' }).click();
  await expect(page.getByTestId('recovery-codes')).toBeVisible();
  await page.getByRole('button', { name: 'I’ve saved them' }).click();
  await expect(page.getByTestId('mfa-status')).toContainText('On');
  await expect(page.getByTestId('sessions')).toContainText('This device');

  // Sign out and back in: the password alone isn't enough any more.
  await page.locator('aside').getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  await page.getByLabel('Email').fill(OWNER.email);
  await page.getByLabel('Password').fill(OWNER.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Two-step sign-in' })).toBeVisible();
  await page.getByLabel('Verification code').fill('123456');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByText('That code didn’t match')).toBeVisible();
  await page.getByLabel('Verification code').fill(totpCode(secret, 1));
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('heading', { name: /Good (morning|afternoon|evening)/ })).toBeVisible();

  // Turn it off again (password + a fresh code).
  await page.goto(`${ADMIN}/admin/account`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Turn off' }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Password').fill(OWNER.password);
  await d.getByLabel(/Code from your authenticator/).fill(totpCode(secret, -1));
  await d.getByRole('button', { name: 'Turn off' }).click();
  await expect(page.getByText('Two-step sign-in is off')).toBeVisible();
  expect(CITY).toBeTruthy();
  done();
});
