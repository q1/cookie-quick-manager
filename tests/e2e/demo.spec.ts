import { readFile } from 'node:fs/promises';
import { test, expect, cookieRows, openWorkbench, syntheticCookie } from './fixtures';

test('opens a useful local workspace without exposing values or making remote requests', async ({
  page,
}) => {
  const remoteRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (['http:', 'https:'].includes(url.protocol) && url.hostname !== '127.0.0.1')
      remoteRequests.push(request.url());
  });
  await openWorkbench(page);
  await expect(page.getByText('Demo', { exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Security' })).toBeVisible();
  await expect(page.locator('main')).not.toContainText('demo-session-a1b2c3d4');
  expect(remoteRequests).toEqual([]);
});

test('creates, edits, deletes and restores a cookie while values start hidden', async ({
  page,
}) => {
  await openWorkbench(page);
  await page.getByRole('button', { name: 'New cookie', exact: true }).click();
  let editor = page.getByRole('complementary', { name: 'New cookie', exact: true });
  await editor.getByLabel('Name', { exact: true }).fill('loom_e2e');
  await editor.getByLabel('Value', { exact: true }).fill('a-secret-looking-synthetic-value');
  await editor.getByLabel('Domain', { exact: true }).fill('example.test');
  await expect(editor.getByLabel('Value', { exact: true })).toHaveAttribute('type', 'password');
  await editor.getByRole('button', { name: 'Create cookie', exact: true }).click();
  await expect(cookieRows(page)).toHaveCount(16);
  editor = page.getByRole('complementary', { name: 'Cookie details' });
  await expect(editor.getByLabel('Name', { exact: true })).toHaveValue('loom_e2e');
  await editor.getByRole('button', { name: 'Reveal value' }).click();
  await expect(editor.getByLabel('Value', { exact: true })).toHaveAttribute('type', 'text');
  await editor.getByLabel('Value', { exact: true }).fill('edited-synthetic-value');
  await editor.getByLabel('Path', { exact: true }).fill('/account');
  await editor.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Cookie updated.', { exact: true })).toBeVisible();
  await editor.getByRole('button', { name: 'Close cookie details' }).click();
  await page.getByRole('button', { name: 'loom_e2e', exact: true }).click();
  editor = page.getByRole('complementary', { name: 'Cookie details' });
  await expect(editor.getByLabel('Path', { exact: true })).toHaveValue('/account');
  await expect(editor.getByLabel('Value', { exact: true })).toHaveValue('edited-synthetic-value');
  await expect(editor.getByLabel('Value', { exact: true })).toHaveAttribute('type', 'password');
  await editor.getByRole('button', { name: 'Delete cookie', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Delete cookies?' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Delete cookies', exact: true }).click();
  await expect(cookieRows(page)).toHaveCount(15);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(cookieRows(page)).toHaveCount(16);
  await expect(page.getByRole('button', { name: 'loom_e2e', exact: true })).toBeVisible();
});

test('combines search operators with store and current-site filters', async ({ page }) => {
  await openWorkbench(page);
  const search = page.getByRole('textbox', { name: 'Search cookies' });
  await search.fill('domain:github.com is:session');
  await expect(cookieRows(page)).toHaveCount(2);
  await expect(page.getByRole('button', { name: '_gh_sess', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'user_session', exact: true })).toBeVisible();
  await search.fill('value:"dark" -is:httponly');
  await expect(cookieRows(page)).toHaveCount(2);
  await search.fill('');
  await page.getByRole('combobox', { name: 'Filter by store' }).selectOption('demo-personal');
  await expect(cookieRows(page)).toHaveCount(2);
  await page.getByRole('combobox', { name: 'Filter by store' }).selectOption('');
  await page.getByRole('button', { name: 'Current site: example.com' }).click();
  await expect(page.getByRole('button', { name: 'Current site: example.com' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(cookieRows(page)).toHaveCount(6);
  await expect(page.getByRole('button', { name: 'user_session', exact: true })).toHaveCount(0);
});

test('cleanup respects protection and undo restores only the deleted view', async ({ page }) => {
  await openWorkbench(page);
  await page.getByRole('textbox', { name: 'Search cookies' }).fill('domain:example.com');
  await expect(cookieRows(page)).toHaveCount(6);
  await page.getByRole('button', { name: 'Clear unprotected', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Delete 4 unprotected cookies?');
  await dialog.getByRole('button', { name: 'Delete cookies', exact: true }).click();
  await expect(cookieRows(page)).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'session_id', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '__Host-session', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(cookieRows(page)).toHaveCount(6);
  await page.getByRole('textbox', { name: 'Search cookies' }).fill('');
  await expect(cookieRows(page)).toHaveCount(15);
});

test('previews valid and invalid import rows without mutating, then preserves saved stores', async ({
  page,
}) => {
  await openWorkbench(page);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const cookies = [
    syntheticCookie('imported_cookie'),
    syntheticCookie('invalid_cookie', { domain: 'bad host' }),
  ];
  await dialog.getByLabel('Or paste contents').fill(
    JSON.stringify({
      format: 'cookie-loom',
      version: 1,
      exportedAt: new Date().toISOString(),
      cookies,
      stores: [],
    }),
  );
  await dialog.getByRole('button', { name: 'Review import', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: '1 valid cookies' })).toBeVisible();
  await expect(dialog).toContainText('1 invalid rows');
  await expect(cookieRows(page)).toHaveCount(15);
  await expect(page.getByRole('button', { name: 'imported_cookie', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Import 1 cookies', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText(
    '1 imported · 0 skipped · 0 failed · 1 invalid rows excluded',
  );
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search cookies' }).fill('name:imported_cookie');
  await page.getByRole('combobox', { name: 'Filter by store' }).selectOption('demo-default');
  await expect(cookieRows(page)).toHaveCount(1);
  await page.getByRole('combobox', { name: 'Filter by store' }).selectOption('demo-personal');
  await expect(cookieRows(page)).toHaveCount(0);
});

test('requires explicit acknowledgment to map unavailable stores and rejects collapsed identities', async ({
  page,
}) => {
  await openWorkbench(page);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('Or paste contents')
    .fill(
      JSON.stringify([syntheticCookie('private_import', { storeId: 'unavailable-private-store' })]),
    );
  await dialog.getByRole('button', { name: 'Review import', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText(
    'Unavailable stores: unavailable-private-store',
  );
  await expect(dialog.getByRole('button', { name: 'Import 1 cookies' })).toBeDisabled();
  await expect(cookieRows(page)).toHaveCount(15);
  await dialog.getByRole('combobox', { name: 'Store handling' }).selectOption('map');
  await dialog.getByLabel('Destination store').selectOption('demo-personal');
  await dialog.getByRole('button', { name: 'Review import', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Import 1 cookies' })).toBeDisabled();
  await dialog
    .getByRole('checkbox', { name: /I understand private and container cookies will share/ })
    .check();
  await expect(dialog.getByRole('button', { name: 'Import 1 cookies' })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Import 1 cookies' }).click();
  await expect(dialog.getByRole('status')).toContainText('1 imported');
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await dialog
    .getByLabel('Or paste contents')
    .fill(
      JSON.stringify([
        syntheticCookie('same_identity', { storeId: 'demo-default' }),
        syntheticCookie('same_identity', { storeId: 'demo-work' }),
      ]),
    );
  await dialog.getByRole('combobox', { name: 'Store handling' }).selectOption('map');
  await dialog
    .getByRole('checkbox', { name: /I understand private and container cookies will share/ })
    .check();
  await dialog.getByRole('button', { name: 'Review import', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText(
    'would share an identity in the destination',
  );
  await expect(dialog.getByRole('button', { name: 'Import 2 cookies' })).toBeDisabled();
});

test('exports only selected cookies with full JSON identity and warns about Netscape loss', async ({
  page,
}, testInfo) => {
  await openWorkbench(page);
  await page
    .getByRole('checkbox', { name: 'Select session_id on .example.com', exact: true })
    .check();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('1 cookie selected.');
  const pendingDownload = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download backup' }).click();
  const download = await pendingDownload;
  expect(download.suggestedFilename()).toMatch(/^cookie-loom-\d{4}-\d{2}-\d{2}\.json$/);
  const path = testInfo.outputPath('synthetic-cookie-backup.json');
  await download.saveAs(path);
  const data = JSON.parse(await readFile(path, 'utf8'));
  expect(data).toMatchObject({ format: 'cookie-loom', version: 1 });
  expect(data.cookies).toHaveLength(1);
  expect(data.cookies[0]).toMatchObject({
    name: 'session_id',
    domain: '.example.com',
    path: '/',
    storeId: 'demo-default',
  });
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search cookies' }).fill('is:partitioned');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('File format').selectOption('netscape');
  await expect(dialog).toContainText('Netscape format cannot preserve SameSite');
  await expect(dialog).toContainText('would create unpartitioned cookies');
});

test('copies a selected cookie only after destination acknowledgment and skips existing identities', async ({
  page,
}) => {
  await openWorkbench(page);
  const search = page.getByRole('textbox', { name: 'Search cookies' });
  const store = page.getByRole('combobox', { name: 'Filter by store' });
  await search.fill('name:session_id');
  await store.selectOption('demo-default');
  await expect(cookieRows(page)).toHaveCount(1);
  await expect(page.locator('.cookie-table tbody .domain-column .cell-truncate')).toHaveAttribute(
    'title',
    '.example.com · / · demo-default · domain cookie',
  );
  await page
    .getByRole('checkbox', { name: 'Select session_id on .example.com', exact: true })
    .check();
  await page.getByRole('button', { name: 'Copy to store', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Copy cookies to a store' });
  await dialog.getByRole('combobox', { name: 'Destination store' }).selectOption('demo-work');
  await expect(dialog.getByRole('button', { name: 'Copy 1 cookies' })).toBeDisabled();
  await dialog.getByRole('checkbox', { name: 'I confirm Work is the destination.' }).check();
  await dialog.getByRole('button', { name: 'Copy 1 cookies' }).click();
  await expect(dialog.getByRole('status')).toContainText('1 copied · 0 skipped · 0 failed');
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(cookieRows(page)).toHaveCount(1);
  await store.selectOption('demo-work');
  await expect(cookieRows(page)).toHaveCount(1);
  await store.selectOption('demo-default');
  await expect(page.locator('.cookie-table tbody .domain-column .cell-truncate')).toHaveAttribute(
    'title',
    '.example.com · / · demo-default · domain cookie',
  );
  await page
    .getByRole('checkbox', { name: 'Select session_id on .example.com', exact: true })
    .check();
  await page.getByRole('button', { name: 'Copy to store', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Copy cookies to a store' });
  await dialog.getByRole('combobox', { name: 'Destination store' }).selectOption('demo-work');
  await expect(dialog.getByRole('status')).toContainText('0 ready to copy · 1 will be skipped');
  await dialog.getByRole('checkbox', { name: 'I confirm Work is the destination.' }).check();
  await expect(dialog.getByRole('button', { name: 'Copy 0 cookies' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await store.selectOption('');
  await expect(cookieRows(page)).toHaveCount(2);
  await page.getByRole('button', { name: 'Protected', exact: true }).click();
  await expect(cookieRows(page)).toHaveCount(1);
});

test('URL decoding changes only the draft until the user saves', async ({ page }) => {
  await openWorkbench(page);
  await page.getByRole('button', { name: 'preferences', exact: true }).click();
  let editor = page.getByRole('complementary', { name: 'Cookie details' });
  const original = await editor.getByLabel('Value', { exact: true }).inputValue();
  await editor.getByLabel('Value', { exact: true }).fill('hello%20cookie');
  await editor.getByText('Value tools', { exact: true }).click();
  await editor.getByRole('button', { name: 'URL decode', exact: true }).click();
  await expect(editor.getByLabel('Value', { exact: true })).toHaveValue('hello cookie');
  await editor.getByRole('button', { name: 'Close cookie details' }).click();
  await page
    .getByRole('dialog', { name: 'Discard changes?', exact: true })
    .getByRole('button', { name: 'Discard changes', exact: true })
    .click();
  await page.getByRole('button', { name: 'preferences', exact: true }).click();
  editor = page.getByRole('complementary', { name: 'Cookie details' });
  await expect(editor.getByLabel('Value', { exact: true })).toHaveValue(original);
  await editor.getByLabel('Value', { exact: true }).fill('hello%20cookie');
  await editor.getByText('Value tools', { exact: true }).click();
  await editor.getByRole('button', { name: 'URL decode', exact: true }).click();
  await editor.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Cookie updated.', { exact: true })).toBeVisible();
  await editor.getByRole('button', { name: 'Close cookie details' }).click();
  await page.getByRole('button', { name: 'preferences', exact: true }).click();
  editor = page.getByRole('complementary', { name: 'Cookie details' });
  await expect(editor.getByLabel('Value', { exact: true })).toHaveValue('hello cookie');
  await expect(editor.getByLabel('Value', { exact: true })).toHaveAttribute('type', 'password');
});

test('keyboard search and native modal focus stay usable', async ({ page }) => {
  await openWorkbench(page);
  await page.keyboard.press('/');
  await expect(page.getByRole('textbox', { name: 'Search cookies' })).toBeFocused();
  await page.keyboard.type('name:consent');
  await expect(cookieRows(page)).toHaveCount(1);
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveAccessibleName('Export cookies');
  for (let index = 0; index < 8; index++) {
    // Chromium can momentarily focus browser chrome (represented by body)
    // while wrapping Tab. It must never focus another application control.
    expect(
      await dialog.evaluate(
        (element) =>
          element.contains(document.activeElement) || document.activeElement === document.body,
      ),
    ).toBe(true);
    await page.keyboard.press('Tab');
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeFocused();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('textbox', { name: 'Search cookies' })).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('?');
  const help = page.getByRole('dialog', { name: 'Search & shortcuts', exact: true });
  await expect(help).toBeVisible();
  await expect(help).toContainText('Ctrl K');
  await page.keyboard.press('Escape');
  await expect(help).toHaveCount(0);
});

test('theme controls use local preference state and system color scheme', async ({ page }) => {
  await openWorkbench(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.getByRole('button', { name: 'System', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('checkbox', { name: 'Clear cookies on startup' })).not.toBeChecked();
  await page.getByRole('checkbox', { name: 'Clear cookies on startup' }).click();
  await expect(page.getByRole('dialog')).toContainText('cannot be undone');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Clear cookies on startup' })).not.toBeChecked();
});

test('popup scopes to the current store and keeps protected session cookies during quick cleanup', async ({
  page,
}) => {
  await page.goto('/?view=popup');
  await expect(page.getByRole('heading', { name: 'example.com', exact: true })).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Site cookies' }).getByText('session_id', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('user_session', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Protect session cookies', exact: true }).click();
  await page.getByRole('button', { name: 'Clear 4 unprotected cookies', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('This action cannot be undone.');
  await dialog.getByRole('button', { name: 'Clear cookies', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Site cookies' }).getByText('session_id', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('preferences', { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Clear 0 unprotected cookies', exact: true }),
  ).toBeDisabled();
});

test('changing a filter clears hidden selections before bulk actions', async ({ page }) => {
  await openWorkbench(page);
  await page
    .getByRole('checkbox', { name: 'Select session_id on .example.com', exact: true })
    .check();
  await expect(page.getByText('1 selected', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Filter by store' }).selectOption('demo-personal');
  await expect(cookieRows(page)).toHaveCount(2);
  await expect(page.getByText('1 selected', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Export cookies' });
  await expect(dialog).toContainText('2 cookies selected.');
  await expect(dialog).not.toContainText('session_id');
});

test('undo preserves a cookie recreated after deletion', async ({ page }) => {
  await openWorkbench(page);
  const create = async (value: string) => {
    await page.getByRole('button', { name: 'New cookie', exact: true }).click();
    const editor = page.locator('.inspector');
    await editor.getByLabel('Name', { exact: true }).fill('undo_recreated');
    await editor.getByLabel('Value', { exact: true }).fill(value);
    await editor.getByLabel('Domain', { exact: true }).fill('example.test');
    await editor.getByRole('button', { name: 'Create cookie', exact: true }).click();
    await expect(page.getByText('Cookie created.', { exact: true })).toBeVisible();
    return editor;
  };
  let editor = await create('deleted-value');
  await editor.getByRole('button', { name: 'Delete cookie', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Delete cookies?' })
    .getByRole('button', { name: 'Delete cookies', exact: true })
    .click();
  await expect(cookieRows(page)).toHaveCount(15);
  editor = await create('recreated-value');
  await editor.getByRole('button', { name: 'Close cookie details', exact: true }).click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(cookieRows(page)).toHaveCount(16);
  await page.getByRole('button', { name: 'undo_recreated', exact: true }).click();
  await expect(page.locator('.inspector').getByLabel('Value', { exact: true })).toHaveValue(
    'recreated-value',
  );
});

test('unsaved edits survive canceled close and require confirmation before changing rows', async ({
  page,
}) => {
  await openWorkbench(page);
  await page.getByRole('button', { name: 'preferences', exact: true }).click();
  const editor = page.locator('.inspector');
  const original = await editor.getByLabel('Value', { exact: true }).inputValue();
  await editor.getByLabel('Value', { exact: true }).fill('unsaved-synthetic-value');
  // Re-selecting the same row must keep both the draft and its dirty guard.
  await page.getByRole('button', { name: 'preferences', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Discard changes?', exact: true })).toHaveCount(0);
  await expect(editor.getByLabel('Value', { exact: true })).toHaveValue('unsaved-synthetic-value');
  await page.keyboard.press('Escape');
  let dialog = page.getByRole('dialog', { name: 'Discard changes?', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await expect(editor.getByLabel('Value', { exact: true })).toHaveValue('unsaved-synthetic-value');
  await page.getByRole('button', { name: 'consent', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Discard changes?', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(editor.getByLabel('Name', { exact: true })).toHaveValue('consent');
  await page.getByRole('button', { name: 'preferences', exact: true }).click();
  await expect(editor.getByLabel('Value', { exact: true })).toHaveValue(original);
});

test('selection exposes a mixed header state and can be cleared explicitly', async ({ page }) => {
  await openWorkbench(page);
  await page
    .getByRole('checkbox', { name: 'Select session_id on .example.com', exact: true })
    .check();
  const selectAll = page.getByRole('checkbox', { name: 'Select all visible cookies', exact: true });
  await expect(selectAll).toHaveJSProperty('indeterminate', true);
  await expect(selectAll).not.toBeChecked();
  await page.getByRole('button', { name: 'Clear selection', exact: true }).click();
  await expect(selectAll).toHaveJSProperty('indeterminate', false);
  await expect(page.getByText('1 selected', { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('checkbox', { name: 'Select session_id on .example.com', exact: true }),
  ).not.toBeChecked();
});

test('invalid fields retain stable accessible names and describe their error', async ({ page }) => {
  await openWorkbench(page);
  await page.getByRole('button', { name: 'New cookie', exact: true }).click();
  const editor = page.locator('.inspector');
  const domain = editor.getByRole('textbox', { name: 'Domain', exact: true });
  await domain.fill('invalid host');
  await expect(domain).toHaveAttribute('aria-invalid', 'true');
  await expect(domain).toHaveAccessibleDescription(/domain|hostname/i);
  await editor.getByRole('button', { name: 'Create cookie', exact: true }).click();
  await expect(editor.getByRole('alert')).toContainText('Resolve the highlighted fields');
  await expect(cookieRows(page)).toHaveCount(15);
});

test('table values reveal only on request and its copy action writes the selected value', async ({
  page,
  context,
  browserName,
}) => {
  if (browserName === 'chromium')
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openWorkbench(page);
  const row = cookieRows(page).filter({
    has: page.getByRole('button', { name: 'preferences', exact: true }),
  });
  const cell = row.locator('.value-column');
  await expect(cell).toHaveText('••••••••');
  await page.getByRole('button', { name: 'Show values', exact: true }).click();
  await expect(cell).toHaveText('{"theme":"dark","language":"en"}');
  await page.getByRole('button', { name: 'Hide values', exact: true }).click();
  await expect(cell).toHaveText('••••••••');
  await row.getByRole('button', { name: /^Copy value of preferences on / }).click();
  await expect(page.getByText('Value copied.', { exact: true })).toBeVisible();
  if (browserName === 'chromium') {
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe('{"theme":"dark","language":"en"}');
  }
});
