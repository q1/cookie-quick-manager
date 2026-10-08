import { test, expect, openWorkbench } from './fixtures';

test('standard Netscape flags control scope and changing compatibility invalidates the preview', async ({
  page,
}) => {
  await openWorkbench(page);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Import cookies', exact: true });
  const compatibility = dialog.getByRole('checkbox', {
    name: 'Legacy Cookie Quick Manager Netscape export',
    exact: true,
  });
  await expect(compatibility).not.toBeChecked();
  await dialog
    .getByLabel('Or paste contents')
    .fill(
      'scope.example.test\tTRUE\t/\tTRUE\t0\tstandard_domain\tvalue\n' +
        '.scope.example.test\tFALSE\t/\tTRUE\t0\tstandard_host\tvalue',
    );
  await dialog.getByRole('button', { name: 'Review import', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: '2 valid cookies' })).toBeVisible();
  await compatibility.check();
  await expect(dialog.getByRole('heading', { name: '2 valid cookies' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Import 2 cookies', exact: true })).toHaveCount(
    0,
  );
  await dialog.getByRole('button', { name: 'Review import', exact: true }).click();
  await expect(dialog).toContainText('Legacy Cookie Quick Manager mode is enabled');
  await compatibility.uncheck();
  await expect(dialog.getByRole('heading', { name: '2 valid cookies' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Review import', exact: true }).click();
  await dialog.getByRole('button', { name: 'Import 2 cookies', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('2 imported · 0 skipped · 0 failed');
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  for (const cookie of [
    { name: 'standard_domain', domain: '.scope.example.test', hostOnly: false },
    { name: 'standard_host', domain: 'scope.example.test', hostOnly: true },
  ]) {
    await page.getByRole('button', { name: cookie.name, exact: true }).click();
    const editor = page.locator('.inspector');
    await expect(editor.getByLabel('Domain', { exact: true })).toHaveValue(cookie.domain);
    await expect(editor.getByRole('checkbox', { name: 'Host only', exact: true })).toBeChecked({
      checked: cookie.hostOnly,
    });
    await editor.getByRole('button', { name: 'Close cookie details', exact: true }).click();
  }
});

test('explicit legacy Netscape compatibility repairs old reversed scope flags', async ({
  page,
}) => {
  await openWorkbench(page);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Import cookies', exact: true });
  await dialog
    .getByLabel('Or paste contents')
    .fill(
      'scope.example.test\tTRUE\t/\tTRUE\t0\tlegacy_host\tvalue\n' +
        '.scope.example.test\tFALSE\t/\tTRUE\t0\tlegacy_domain\tvalue',
    );
  await dialog
    .getByRole('checkbox', {
      name: 'Legacy Cookie Quick Manager Netscape export',
      exact: true,
    })
    .check();
  await dialog.getByRole('button', { name: 'Review import', exact: true }).click();
  await expect(dialog).toContainText('Legacy Cookie Quick Manager mode is enabled');
  await dialog.getByRole('button', { name: 'Import 2 cookies', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('2 imported · 0 skipped · 0 failed');
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  for (const cookie of [
    { name: 'legacy_host', domain: 'scope.example.test', hostOnly: true },
    { name: 'legacy_domain', domain: '.scope.example.test', hostOnly: false },
  ]) {
    await page.getByRole('button', { name: cookie.name, exact: true }).click();
    const editor = page.locator('.inspector');
    await expect(editor.getByLabel('Domain', { exact: true })).toHaveValue(cookie.domain);
    await expect(editor.getByRole('checkbox', { name: 'Host only', exact: true })).toBeChecked({
      checked: cookie.hostOnly,
    });
    await editor.getByRole('button', { name: 'Close cookie details', exact: true }).click();
  }
});
