import { test as base, expect, type Page } from '@playwright/test';

export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await use(errors);
      expect(errors, 'No uncaught application exceptions or console errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export function cookieRows(page: Page) {
  return page.locator('.cookie-table tbody tr');
}

export async function openWorkbench(page: Page) {
  await page.goto('/');
  await expect(page).toHaveTitle('Cookie Loom · Demo workspace');
  await expect(page.getByRole('heading', { name: 'Cookies', exact: true })).toBeVisible();
  await expect(cookieRows(page)).toHaveCount(15);
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  // Wide demos showcase the inspector. Narrow screens start with the list.
  if ((page.viewportSize()?.width ?? 1440) > 1180) {
    await page.getByRole('button', { name: 'Close cookie details' }).click();
  } else {
    await expect(page.locator('.inspector')).toHaveCount(0);
  }
}

export function syntheticCookie(name: string, extra: Record<string, unknown> = {}) {
  return {
    name,
    value: 'synthetic-value',
    domain: 'import.example.test',
    path: '/',
    secure: true,
    httpOnly: false,
    hostOnly: true,
    session: true,
    sameSite: 'lax',
    storeId: 'demo-default',
    ...extra,
  };
}
