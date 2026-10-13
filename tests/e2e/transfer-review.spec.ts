import { test, expect, openWorkbench } from './fixtures';

test('selected backups are reviewed in a worker without filling the textarea or changing cookies', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openWorkbench(page);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Import cookies' });
  const text =
    '# Netscape HTTP Cookie File\n' +
    Array.from(
      { length: 2000 },
      (_, index) => `example.test\tFALSE\t/p/${index}\tTRUE\t0\tfile_${index}\t${'x'.repeat(256)}`,
    ).join('\n');
  await dialog.getByLabel('Backup file').setInputFiles({
    name: `synthetic-${'long'.repeat(45)}.txt`,
    mimeType: 'text/plain',
    buffer: Buffer.from(text),
  });
  await expect(dialog.getByLabel('Or paste contents')).toHaveValue('');
  await expect(dialog).toContainText('synthetic-');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const started = page.waitForEvent('worker');
  await dialog.getByRole('button', { name: 'Review import', exact: true }).click();
  const worker = await started;
  await expect(dialog.getByRole('heading', { name: '2000 valid cookies' })).toBeVisible();
  await expect(page.locator('.cookie-table tbody tr')).toHaveCount(15);
  await expect.poll(() => page.workers().includes(worker)).toBe(false);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeFocused();
});

test('canceling a pending preview terminates its worker and cannot replace a later preview', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      closed = false;
      postMessage(value: unknown) {
        setTimeout(() => {
          if (!this.closed) super.postMessage(value);
        }, 500);
      }
      terminate() {
        this.closed = true;
        super.terminate();
      }
    };
  });
  await openWorkbench(page);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Import cookies' });
  await dialog.getByLabel('Backup file').setInputFiles({
    name: 'cancel-me.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('example.test\tFALSE\t/\tTRUE\t0\told_preview\tvalue'),
  });
  const started = page.waitForEvent('worker');
  await dialog.getByRole('button', { name: 'Review import', exact: true }).click();
  const worker = await started;
  await expect(dialog.getByRole('button', { name: 'Reviewing…' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect.poll(() => page.workers().includes(worker)).toBe(false);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await dialog
    .getByLabel('Or paste contents')
    .fill('example.test\tFALSE\t/\tTRUE\t0\tnew_preview\tvalue');
  await dialog.getByRole('button', { name: 'Review import', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: '1 valid cookies' })).toBeVisible();
  await expect(dialog).toContainText('new_preview');
  await expect(dialog).not.toContainText('old_preview');
});

test('pasting replaces a selected file and oversized files cannot leave a stale source', async ({
  page,
}) => {
  await openWorkbench(page);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Import cookies' });
  const fileInput = dialog.getByLabel('Backup file');
  await fileInput.setInputFiles({
    name: 'old-file.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('# old'),
  });
  await dialog
    .getByLabel('Or paste contents')
    .fill('example.test\tFALSE\t/\tTRUE\t0\tpasted_cookie\tvalue');
  await expect(fileInput).toHaveValue('');
  await dialog.getByRole('button', { name: 'Review import', exact: true }).click();
  await expect(dialog).toContainText('pasted_cookie');
  await fileInput.setInputFiles({
    name: 'oversized.txt',
    mimeType: 'text/plain',
    buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
  });
  await expect(dialog.getByRole('alert')).toContainText('smaller than 10 MiB');
  await expect(dialog.getByRole('button', { name: 'Review import', exact: true })).toBeDisabled();
});

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
