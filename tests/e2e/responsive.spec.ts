import { test, expect, openWorkbench } from './fixtures';

for (const width of [320, 390, 768, 1024, 1440]) {
  test(`workbench and its dialogs fit a ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
    await openWorkbench(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await expect(page.getByRole('button', { name: 'New cookie', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'preferences', exact: true }).click();
    const editor = page.locator('.inspector');
    await expect(editor).toBeVisible();
    const bounds = await editor.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await editor.getByRole('button', { name: 'Reveal value', exact: true }).click();
    await expect(editor.getByLabel('Value', { exact: true })).toHaveAttribute('type', 'text');
    await editor.getByRole('button', { name: 'Close cookie details', exact: true }).click();
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Import cookies', exact: true });
    const dialogBounds = await dialog.boundingBox();
    expect(dialogBounds).not.toBeNull();
    expect(dialogBounds!.x).toBeGreaterThanOrEqual(0);
    expect(dialogBounds!.x + dialogBounds!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeFocused();
  });
}

for (const width of [320, 390, 768]) {
  test(`popup fits a ${width}px viewport and opens the workbench`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/?view=popup');
    await expect(page.getByRole('heading', { name: 'example.com', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await page.getByRole('button', { name: 'Open workbench', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Cookies', exact: true })).toBeVisible();
    await expect(page).toHaveURL('http://127.0.0.1:5173/');
  });
}

test('compact editor keeps dirty changes when Escape confirmation is canceled', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await openWorkbench(page);
  await page.getByRole('button', { name: 'preferences', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Cookie details', exact: true });
  await editor.getByLabel('Value', { exact: true }).fill('compact-unsaved-value');
  await page.keyboard.press('Escape');
  const confirmation = page.getByRole('dialog', { name: 'Discard changes?', exact: true });
  await expect(confirmation).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await confirmation.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel('Value', { exact: true })).toHaveValue('compact-unsaved-value');
  await page.keyboard.press('Escape');
  await confirmation.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'preferences', exact: true })).toBeFocused();
});

test('mobile domain filtering stays within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await openWorkbench(page);
  const domain = page.getByRole('combobox', { name: 'Filter by domain', exact: true });
  await expect(domain).toBeVisible();
  await domain.selectOption('github.com');
  await expect(page.locator('.cookie-table tbody tr')).toHaveCount(4);
  await expect(page.getByRole('button', { name: '_gh_sess', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'session_id', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await domain.selectOption('');
  await expect(page.locator('.cookie-table tbody tr')).toHaveCount(15);
});
