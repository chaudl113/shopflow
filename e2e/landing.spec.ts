import { expect, test } from '@playwright/test';

// A visitor gets from the landing page into the app in one click, without typing a password.
// On the public demo this uses POST /api/auth/demo; a local install signs in with the seeded password.

test('landing → one click into each role, and the public booking page', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  for (const name of ['Stock is a ledger', 'Two-step transfers', 'Cash shifts', 'No double booking']) {
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  }

  await page.getByRole('link', { name: /Book an appointment as a customer/ }).click();
  await expect(page).toHaveURL(/\/book\/downtown$/);
  await expect(page.getByTestId('public-store-name')).toBeVisible();

  await page.goto('/');
  await page.getByRole('button', { name: /Try as Owner/ }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  // Signed in, the landing page steps aside.
  await page.goto('/');
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.evaluate(() => localStorage.clear());
  await page.goto('/login');
  await page.getByRole('button', { name: /Try as Cashier/ }).click();
  await expect(page).toHaveURL(/\/pos$/);
});
