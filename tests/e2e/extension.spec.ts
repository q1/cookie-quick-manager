import { test, expect, chromium, type BrowserContext } from '@playwright/test';
import { access, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const buildDirectory = path.resolve('apps/extension/.output/chrome-mv3');

async function launchExtension(directory: string) {
  await access(path.join(directory, 'manifest.json')).catch(() => {
    throw new Error(
      'Build the browser artifacts with npm run build before running extension tests.',
    );
  });
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    args: [`--disable-extensions-except=${directory}`, `--load-extension=${directory}`],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;
    return { context, id };
  } catch (error) {
    await context.close();
    throw error;
  }
}

async function workbench(context: BrowserContext, id: string) {
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(`chrome-extension://${id}/workbench.html`);
  await expect(page).toHaveTitle('Cookie Loom');
  await expect(page.getByRole('heading', { name: 'Cookies', exact: true })).toBeVisible();
  return { page, errors };
}

test('the unchanged production extension loads with an explicit no-host-access state', async () => {
  const { context, id } = await launchExtension(buildDirectory);
  try {
    const { page, errors } = await workbench(context, id);
    await expect(page.getByRole('button', { name: 'Allow website access' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New cookie', exact: true })).toBeDisabled();
    await expect(page.locator('.cookie-table tbody tr')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('the compiled Chromium adapter edits real cookies and preserves protected cleanup with undo', async () => {
  test.setTimeout(45_000);
  const temporary = await mkdtemp(path.join(tmpdir(), 'cookie-loom-chromium-'));
  let context: BrowserContext | undefined;
  try {
    const directory = path.join(temporary, 'extension');
    await cp(buildDirectory, directory, { recursive: true });
    const manifestPath = path.join(directory, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    // Native optional-permission prompts cannot be accepted in headless Chrome.
    // Only this disposable manifest grants hosts up front. All compiled product
    // code is unchanged; the production permission UX remains a manual check.
    manifest.host_permissions = ['http://*/*', 'https://*/*'];
    await writeFile(manifestPath, JSON.stringify(manifest));
    const launched = await launchExtension(directory);
    context = launched.context;
    await context.addCookies([
      {
        url: 'http://127.0.0.1:5173',
        name: 'native_seed',
        value: 'synthetic-native-value',
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    const { page, errors } = await workbench(context, launched.id);
    await expect(page.getByRole('button', { name: 'native_seed', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'native_seed', exact: true }).click();
    let editor = page.getByRole('complementary', { name: 'Cookie details' });
    await expect(editor.getByLabel('Value', { exact: true })).toHaveAttribute('type', 'password');
    await expect(editor.getByLabel('Value', { exact: true })).toHaveValue('synthetic-native-value');
    await editor.getByLabel('Value', { exact: true }).fill('synthetic-native-edited');
    await editor.getByLabel('Path', { exact: true }).fill('/account');
    await editor.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Cookie updated.', { exact: true })).toBeVisible();
    const actual = (await context.cookies()).filter((cookie) => cookie.name === 'native_seed');
    expect(actual).toHaveLength(1);
    expect(actual[0]).toMatchObject({
      value: 'synthetic-native-edited',
      path: '/account',
      httpOnly: true,
    });
    editor = page.getByRole('complementary', { name: 'Cookie details' });
    await editor.getByRole('checkbox', { name: 'Protected from cleanup' }).click();
    await expect(editor.getByRole('checkbox', { name: 'Protected from cleanup' })).toBeChecked();
    await expect(editor.getByRole('button', { name: 'Delete cookie', exact: true })).toBeDisabled();
    await editor.getByRole('button', { name: 'Close cookie details' }).click();
    await page.getByRole('button', { name: 'New cookie', exact: true }).click();
    editor = page.getByRole('complementary', { name: 'New cookie' });
    await editor.getByLabel('Name', { exact: true }).fill('native_delete');
    await editor.getByLabel('Value', { exact: true }).fill('synthetic-delete-value');
    // An extension tab without a captured source has no current website.
    await editor.getByRole('textbox', { name: 'Domain', exact: true }).fill('127.0.0.1');
    await editor.getByRole('checkbox', { name: 'Secure', exact: true }).uncheck();
    await editor.getByRole('button', { name: 'Create cookie', exact: true }).click();
    await expect(page.getByText('Cookie created.', { exact: true })).toBeVisible();
    expect((await context.cookies()).some((cookie) => cookie.name === 'native_delete')).toBe(true);
    await page.getByRole('button', { name: 'Close cookie details' }).click();
    await page.getByRole('button', { name: 'Clear unprotected', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Delete cookies?' })
      .getByRole('button', { name: 'Delete cookies', exact: true })
      .click();
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
    let remaining = await context.cookies();
    expect(remaining.some((cookie) => cookie.name === 'native_seed')).toBe(true);
    expect(remaining.some((cookie) => cookie.name === 'native_delete')).toBe(false);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(
      page.getByText('1 restored · 0 skipped. Existing cookies were kept.', { exact: true }),
    ).toBeVisible();
    remaining = await context.cookies();
    expect(remaining.some((cookie) => cookie.name === 'native_delete')).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await context?.close();
    await rm(temporary, { recursive: true, force: true });
  }
});

test('an editor opened before a live cookie update cannot overwrite the newer value', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'cookie-loom-stale-editor-'));
  let context: BrowserContext | undefined;
  try {
    const directory = path.join(temporary, 'extension');
    await cp(buildDirectory, directory, { recursive: true });
    const manifestPath = path.join(directory, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.host_permissions = ['http://*/*', 'https://*/*'];
    await writeFile(manifestPath, JSON.stringify(manifest));
    const launched = await launchExtension(directory);
    context = launched.context;
    const seed = {
      url: 'http://127.0.0.1:5173',
      name: 'native_stale',
      value: 'synthetic-original',
      httpOnly: true,
      sameSite: 'Lax' as const,
    };
    await context.addCookies([seed]);
    const { page, errors } = await workbench(context, launched.id);
    await page.getByRole('button', { name: 'native_stale', exact: true }).click();
    const editor = page.locator('.inspector');
    await expect(editor.getByLabel('Value', { exact: true })).toHaveValue(seed.value);
    await editor.getByLabel('Value', { exact: true }).fill('synthetic-unsaved-draft');
    await context.addCookies([{ ...seed, value: 'synthetic-site-update' }]);
    await page.getByRole('button', { name: 'Refresh cookies', exact: true }).click();
    await expect(
      editor.getByText('This cookie changed in the browser.', { exact: true }),
    ).toBeVisible();
    await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(editor.getByRole('alert')).toContainText('changed in the browser');
    await expect(editor.getByLabel('Value', { exact: true })).toHaveValue(
      'synthetic-unsaved-draft',
    );
    const actual = (await context.cookies()).find((cookie) => cookie.name === seed.name);
    expect(actual?.value).toBe('synthetic-site-update');
    expect(errors).toEqual([]);
  } finally {
    await context?.close();
    await rm(temporary, { recursive: true, force: true });
  }
});
