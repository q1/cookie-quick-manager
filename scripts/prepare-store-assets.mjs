import { chromium } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'docs/store-assets');
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('http://127.0.0.1:5173');
  await page.getByRole('heading', { name: 'Cookies', exact: true }).waitFor();
  if ((await page.title()) !== 'Cookie Loom · Demo workspace')
    throw new Error('Store images must use the synthetic demo workspace.');
  await page.locator('.cookie-table tbody tr').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  if (await page.locator('vite-error-overlay').count()) throw new Error('Vite error overlay.');
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.screenshot({ path: join(output, `workbench-${theme}.png`) });
  }
  if (errors.length) throw new Error(errors.join('\n'));
  await page.setViewportSize({ width: 440, height: 280 });
  const promotional = await readFile(join(output, 'promo.svg'), 'utf8');
  await page.goto(`data:image/svg+xml,${encodeURIComponent(promotional)}`);
  await page.screenshot({ path: join(output, 'promo.png') });
  console.log('Prepared 1280×800 light/dark screenshots and 440×280 promotional image.');
} finally {
  await browser.close();
}
