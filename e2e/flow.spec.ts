import { expect, test, type Page } from '@playwright/test';
import { cents, ensureShift, signIn } from './helpers';

// The core loop of the product, through the UI only:
// a customer books online → the front desk checks the booking out at the POS together with a retail item
// → the shelf count drops by one in the stock ledger → the owner's dashboard shows the sale today.

const RETAIL = { sku: 'HEAT-SP', barcode: '0850001000055', name: 'Heat Shield Spray' };

async function onHand(page: Page) {
  await page.goto('/inventory');
  await page.getByLabel('Search stock').fill(RETAIL.name);
  const row = page.getByRole('row').filter({ hasText: RETAIL.sku });
  await expect(row).toHaveCount(1);
  return Number(await row.getByRole('cell').nth(2).locator('span').first().innerText());
}

/** Opens the booking from the week calendar (it may fall in next week). */
async function openBooking(page: Page, reference: string) {
  await page.goto('/bookings');
  await expect(page.locator('[data-testid^="booking-BK-"]').first()).toBeVisible();
  const chip = page.getByTestId(`booking-${reference}`);
  if (!(await chip.isVisible())) await page.getByRole('button', { name: 'Next week' }).click();
  await chip.click();
}

async function todayKpis(page: Page) {
  await page.goto('/dashboard');
  await page.getByTestId('range-today').click();
  // Numbers on screen belong to the "today" range once the dashboard marks it loaded.
  await expect(page.locator('[data-loaded="today:all"]')).toBeVisible();
  const value = async (id: string) => page.getByTestId(id).locator('[data-slot=card-title]').innerText();
  return { net: cents(await value('kpi-net-sales')), count: Number(await value('kpi-transactions')) };
}

test('online booking → POS checkout with retail add-on → stock and dashboard update', async ({ browser }) => {
  const errors: string[] = [];
  const watch = (p: Page) => {
    p.on('pageerror', (e) => errors.push(String(e)));
    p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    return p;
  };

  // Baselines: owner's dashboard for today, shelf count at the Downtown store.
  const owner = watch(await (await browser.newContext()).newPage());
  await signIn(owner, 'owner@shopflow.demo');
  const before = await todayKpis(owner);

  const desk = watch(await (await browser.newContext()).newPage());
  await signIn(desk, 'cashier@shopflow.demo');
  const stockBefore = await onHand(desk);

  // 1. Customer books on their phone: Men's Haircut, anyone available, tomorrow, first free slot.
  const phone = watch(await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage());
  await phone.goto('/book/downtown');
  await phone.getByTestId("service-Men's Haircut").click();
  await phone.getByTestId('staff-any').click();
  await phone.locator('[data-slot=calendar-cell-trigger]:not([data-disabled]):not([data-outside-view])').nth(1).click();
  await phone.getByTestId('public-slots').getByRole('button').first().click();
  await phone.getByRole('button', { name: 'Continue' }).click();
  await phone.getByLabel('Name').fill('Jordan Ellis');
  await phone.getByLabel('Phone').fill('(212) 555-0199');
  await phone.getByRole('button', { name: 'Confirm booking' }).click();
  const reference = (await phone.getByTestId('booking-reference').innerText()).trim();
  expect(reference).toMatch(/^BK-[A-Z0-9]{6}$/);

  // 2. Front desk: open the till, find the booking in the calendar and check it out.
  await ensureShift(desk);
  await openBooking(desk, reference);
  await desk.getByRole('button', { name: 'Check out' }).click();
  await expect(desk.getByTestId('cart-booking')).toContainText(reference);
  await expect(desk.getByTestId('cart-line')).toHaveCount(1);
  await expect(desk.getByTestId('cart-total')).not.toHaveText('$0.00');
  const serviceOnly = await desk.getByTestId('cart-total').innerText();

  // Add a retail item by barcode, then take cash.
  await desk.getByLabel('Scan barcode').fill(RETAIL.barcode);
  await desk.keyboard.press('Enter');
  await expect(desk.getByTestId('cart-line')).toHaveCount(2);
  await expect(desk.getByTestId('cart-total')).not.toHaveText(serviceOnly); // server re-quoted the cart
  const cart = desk.getByRole('complementary', { name: 'Cart' });
  const subtotal = cents(await cart.locator('dt', { hasText: 'Subtotal' }).locator('xpath=following-sibling::dd').innerText());
  const total = cents(await desk.getByTestId('cart-total').innerText());
  await desk.getByRole('button', { name: /^Charge/ }).click();
  const pay = desk.getByRole('dialog');
  await pay.getByRole('radio', { name: 'Cash' }).or(pay.getByRole('button', { name: 'Cash', exact: true })).click();
  await desk.getByLabel('Payment 1 amount').fill('100');
  await desk.getByRole('button', { name: 'Complete sale' }).click();
  await expect(desk.getByText('Sale complete')).toBeVisible();
  await expect(desk.getByRole('dialog')).toContainText(new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((10000 - total) / 100));
  await desk.keyboard.press('Escape');

  // The booking is now paid and cannot be charged again.
  await openBooking(desk, reference);
  await expect(desk.getByRole('dialog')).toContainText('Paid');
  await expect(desk.getByRole('dialog').getByRole('button', { name: 'Check out' })).toHaveCount(0);
  await desk.keyboard.press('Escape');

  // 3. Stock ledger: one bottle fewer on the shelf.
  expect(await onHand(desk)).toBe(stockBefore - 1);

  // 4. Dashboard: today's net sales grew by the pre-tax subtotal, one more transaction.
  const after = await todayKpis(owner);
  expect(after.net - before.net).toBe(subtotal);
  expect(after.count).toBe(before.count + 1);

  expect(errors).toEqual([]);
});
