import type { Gateway } from '../../apps/extension/src/lib/types';
import type { Page } from '@playwright/test';
import { test, expect, openWorkbench } from './fixtures';

type ReviewWindow = Window & { reviewGateway: Gateway; releaseSave: () => void };

async function openReviewWorkbench(page: Page) {
  // Capture the exact instance rendered by the demo, even after Vite has invalidated modules.
  await page.route(/\/src\/demo\.tsx(?:\?.*)?$/, async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: `${await response.text()}\nwindow.reviewGateway = demoGateway;\n`,
    });
  });
  await openWorkbench(page);
}

test('pending saves lock draft changes and navigation until the submitted value is saved', async ({
  page,
}) => {
  await openReviewWorkbench(page);
  await page.getByRole('button', { name: 'preferences', exact: true }).click();
  const editor = page.locator('.inspector');
  await editor.getByLabel('Value', { exact: true }).fill('submitted-draft');
  await editor.getByText('Value tools', { exact: true }).click();

  await page.evaluate(async () => {
    const demoGateway = (window as ReviewWindow).reviewGateway;
    const save = demoGateway.saveCookie.bind(demoGateway);
    demoGateway.saveCookie = async (...args) => {
      await new Promise<void>((resolve) => {
        (window as ReviewWindow).releaseSave = resolve;
      });
      demoGateway.saveCookie = save;
      return save(...args);
    };
  });

  await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(editor.getByLabel('Value', { exact: true })).toBeDisabled();
  await expect(editor.getByRole('button', { name: 'URL encode', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'New cookie', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Clear unprotected', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'consent', exact: true }).click();
  await expect(editor.getByLabel('Name', { exact: true })).toHaveValue('preferences');
  await expect(page.getByRole('dialog', { name: 'Discard changes?', exact: true })).toHaveCount(0);

  await page.evaluate(() => (window as ReviewWindow).releaseSave());
  await expect(page.getByText('Cookie updated.', { exact: true })).toBeVisible();
  await expect(editor.getByLabel('Value', { exact: true })).toBeEnabled();
  await expect(editor.getByLabel('Value', { exact: true })).toHaveValue('submitted-draft');
  await expect(editor.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
});

test('external deletion preserves a dirty draft without offering a stale reload or mutation', async ({
  page,
}) => {
  await openReviewWorkbench(page);
  await page.getByRole('button', { name: 'preferences', exact: true }).click();
  const editor = page.locator('.inspector');
  await editor.getByLabel('Value', { exact: true }).fill('keep-my-unsaved-draft');

  await page.evaluate(async () => {
    const demoGateway = (window as ReviewWindow).reviewGateway;
    const cookie = (await demoGateway.listCookies()).find((item) => item.name === 'preferences')!;
    await demoGateway.saveCookie({ ...cookie, value: 'changed-outside-the-editor' }, cookie);
  });
  await expect(
    editor.getByText('This cookie changed in the browser.', { exact: true }),
  ).toBeVisible();
  await expect(editor.getByRole('button', { name: 'Reload cookie', exact: true })).toBeVisible();

  await page.evaluate(async () => {
    const demoGateway = (window as ReviewWindow).reviewGateway;
    const cookie = (await demoGateway.listCookies()).find((item) => item.name === 'preferences')!;
    await demoGateway.deleteCookies([cookie]);
  });
  await expect(editor.getByRole('status')).toContainText(
    'This cookie no longer exists in the browser.',
  );
  await expect(editor.getByRole('button', { name: 'Reload cookie', exact: true })).toHaveCount(0);
  await expect(editor.getByLabel('Value', { exact: true })).toHaveValue('keep-my-unsaved-draft');
  await expect(editor.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled();
  await expect(editor.getByRole('button', { name: 'Delete cookie', exact: true })).toBeDisabled();
  await expect(editor.getByRole('checkbox', { name: 'Protected from cleanup' })).toBeDisabled();

  await editor.getByRole('button', { name: 'Close cookie details', exact: true }).click();
  const discard = page.getByRole('dialog', { name: 'Discard changes?', exact: true });
  await discard.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(editor.getByLabel('Value', { exact: true })).toHaveValue('keep-my-unsaved-draft');
  await editor.getByRole('button', { name: 'Close cookie details', exact: true }).click();
  await discard.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await page.getByRole('button', { name: 'New cookie', exact: true }).click();
  await expect(page.getByRole('complementary', { name: 'New cookie', exact: true })).toBeVisible();
});
