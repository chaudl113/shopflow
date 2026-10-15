import { expect, test, type Page } from '@playwright/test';
import { ensureShift, signIn } from './helpers';

// Writes the README screenshots to docs/screenshots: desktop at 1440 px, phone at 390 px.
// Run with `npm run screenshots` on a freshly seeded database.

const dir = 'docs/screenshots';
async function shot(page: Page, name: string, fullPage = false) {
  // Let notifications ("Shift opened", ...) time out so they do not cover the picture.
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 10_000 });
  await page.screenshot({ path: `${dir}/${name}.png`, fullPage, animations: 'disabled' });
}
const settle = (page: Page) => page.waitForLoadState('networkidle');
/** The landing page shows real screens too: one viewport, compressed. */
const forLanding = (page: Page, name: string) =>
  page.screenshot({ path: `apps/web/public/landing/${name}.jpg`, type: 'jpeg', quality: 78, animations: 'disabled' });

test.describe.configure({ mode: 'serial' });

test.describe('desktop 1440', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('owner: dashboard, light and dark', async ({ page }) => {
    await signIn(page, 'owner@shopflow.demo');
    await page.goto('/dashboard');
    await expect(page.locator('[data-loaded="30d:all"]')).toBeVisible();
    await settle(page);
    await shot(page, 'desktop-dashboard', true);
    await forLanding(page, 'dashboard');
    await page.getByRole('button', { name: 'Switch to dark mode' }).click();
    await page.mouse.move(0, 0);
    await shot(page, 'desktop-dashboard-dark', true);
    await page.getByRole('button', { name: 'Switch to light mode' }).click();
  });

  test('cashier: POS checkout of a booking, payment, receipt', async ({ page }) => {
    await signIn(page, 'cashier@shopflow.demo');
    await ensureShift(page);
    await page.getByRole('button', { name: /Appointments/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await settle(page);
    await shot(page, 'desktop-pos-appointments');
    const checkout = page.getByRole('dialog').getByRole('button', { name: 'Check out' }).first();
    if (await checkout.isVisible()) await checkout.click();
    else await page.keyboard.press('Escape');
    for (const code of ['0850001000055', '0850001000109', '0850001000109']) {
      await page.getByLabel('Scan barcode').fill(code);
      await page.keyboard.press('Enter');
    }
    await expect(page.getByTestId('cart-line').nth(1)).toBeVisible();
    await settle(page);
    await expect(page.getByTestId('cart-total')).not.toHaveText('$0.00');
    await shot(page, 'desktop-pos');
    await forLanding(page, 'pos');
    await page.getByRole('button', { name: /^Charge/ }).click();
    const pay = page.getByRole('dialog');
    await pay.getByRole('radio', { name: 'Cash' }).or(pay.getByRole('button', { name: 'Cash', exact: true })).click();
    await page.getByLabel('Payment 1 amount').fill('150');
    await shot(page, 'desktop-pos-payment');
    await page.getByRole('button', { name: 'Complete sale' }).click();
    await expect(page.getByText('Sale complete')).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).first().click();

    await page.goto('/sales');
    await page.getByRole('row').nth(1).click();
    await expect(page.getByRole('button', { name: 'Return items' })).toBeVisible();
    await settle(page);
    await shot(page, 'desktop-sales');

    await page.goto('/shifts');
    await expect(page.getByTestId('expected-cash')).toBeVisible();
    await settle(page);
    await shot(page, 'desktop-shift');
  });

  test('manager: bookings, inventory ledger, transfers', async ({ page }) => {
    await signIn(page, 'manager@shopflow.demo');
    await page.goto('/bookings');
    await expect(page.locator('[data-testid^="booking-BK-"]').first()).toBeVisible();
    await settle(page);
    await shot(page, 'desktop-bookings');
    await page.getByRole('button', { name: 'Team hours' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await shot(page, 'desktop-team-hours');
    await page.keyboard.press('Escape');

    await page.goto('/inventory');
    await page.getByLabel('Search stock').fill('Argan');
    await page.getByRole('row').filter({ hasText: 'ARG-SH-250' }).getByRole('button', { name: 'History' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await settle(page);
    await shot(page, 'desktop-inventory-ledger');
    await page.keyboard.press('Escape');

    // The warehouse sees both seeded transfers: one received with a shortfall, one in transit.
    await page.getByTestId('store-switch').click();
    await page.getByRole('option', { name: /Central Warehouse/ }).click();
    await page.goto('/transfers');
    await expect(page.locator('[data-testid^="transfer-"]').nth(1)).toBeVisible();
    await settle(page);
    await shot(page, 'desktop-transfers');
  });

  test('visitor: landing page and one-click demo sign-in', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.locator('main img').last().scrollIntoViewIfNeeded();
    await settle(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, 'desktop-landing', true);
    await page.getByRole('link', { name: 'Sign in' }).click();
    await expect(page.getByRole('button', { name: /Try as Owner/ })).toBeVisible();
    await shot(page, 'desktop-login');
  });
});

test.describe('mobile 390', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test('landing page', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: /Try as Cashier/ })).toBeVisible();
    await settle(page);
    await shot(page, 'mobile-landing');
  });

  test('public booking page', async ({ page }) => {
    await page.goto('/book/downtown');
    await expect(page.getByTestId('public-store-name')).toBeVisible();
    await shot(page, 'mobile-book-services', true);
    await page.getByTestId("service-Women's Haircut").click();
    await page.getByTestId('staff-any').click();
    await page.locator('[data-slot=calendar-cell-trigger]:not([data-disabled]):not([data-outside-view])').nth(1).click();
    await expect(page.getByTestId('public-slots')).toBeVisible();
    await shot(page, 'mobile-book-slots', true);
    await page.getByTestId('public-slots').getByRole('button').nth(1).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Name').fill('Riley Chen');
    await page.getByLabel('Phone').fill('(212) 555-0164');
    await page.getByRole('button', { name: 'Confirm booking' }).click();
    await expect(page.getByTestId('booking-reference')).toBeVisible();
    await shot(page, 'mobile-book-confirmed', true);
  });

  test('POS and dashboard on a phone', async ({ page }) => {
    await signIn(page, 'cashier@shopflow.demo');
    await ensureShift(page);
    await page.getByLabel('Scan barcode').fill('0850001000017');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('cart-line')).toHaveCount(1);
    await settle(page);
    await expect(page.getByTestId('cart-total')).not.toHaveText('$0.00');
    await shot(page, 'mobile-pos');

    await signIn(page, 'owner@shopflow.demo');
    await page.goto('/dashboard');
    await expect(page.locator('[data-loaded="30d:all"]')).toBeVisible();
    await settle(page);
    await shot(page, 'mobile-dashboard');
  });
});
