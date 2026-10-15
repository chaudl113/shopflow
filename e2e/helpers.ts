import { expect, type Page } from '@playwright/test';

export const DEMO_PASSWORD = 'demo1234';

export async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.fill('#email', email);
  await page.fill('#password', DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

/** "$1,234.50" -> 123450 */
export const cents = (text: string | null) => Math.round(Number((text ?? '').replace(/[^0-9.-]/g, '')) * 100);

/** Opens the till if the signed-in cashier has no open shift at the current store. */
export async function ensureShift(page: Page) {
  await page.goto('/pos');
  const open = page.getByRole('button', { name: 'Open shift' });
  const scan = page.getByLabel('Scan barcode');
  await expect(open.or(scan)).toBeVisible();
  if (await open.isVisible()) {
    await open.click();
    await expect(scan).toBeVisible();
  }
}
