import { chromium } from '@playwright/test';
import { cp, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const argument = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : process.argv[i + 1];
};
const directory = resolve(argument('--build', 'apps/extension/.output/chrome-mv3'));
const output = argument('--output', undefined);
const samples = Number(argument('--samples', '5'));
if (!Number.isInteger(samples) || samples < 1 || samples > 20)
  throw new Error('Use 1–20 measured samples.');
const text =
  '# Netscape HTTP Cookie File\n' +
  Array.from(
    { length: 10000 },
    (_, index) => `example.test\tFALSE\t/p/${index}\tTRUE\t0\tfile_${index}\t${'v'.repeat(850)}`,
  ).join('\n');
const temporary = await mkdtemp(join(tmpdir(), 'cookie-loom-import-ui-'));
let context;
try {
  const extension = join(temporary, 'extension');
  await cp(directory, extension, { recursive: true });
  const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions = ['http://*/*', 'https://*/*'];
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  const records = [],
    errors = [];
  for (let index = 0; index <= samples; index++) {
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`chrome-extension://${id}/workbench.html`);
    await page.getByRole('button', { name: 'Import', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Import cookies' });
    await page.evaluate(() => {
      window.__uiBench = {
        start: performance.now(),
        maxGap: 0,
        last: performance.now(),
        tasks: [],
        running: true,
      };
      document.addEventListener(
        'change',
        (event) => {
          if (event.target instanceof HTMLInputElement && event.target.type === 'file') {
            window.__uiBench.start = performance.now();
            window.__uiBench.last = performance.now();
            window.__uiBench.maxGap = 0;
          }
        },
        { capture: true, once: true },
      );
      const observer = new PerformanceObserver((list) =>
        window.__uiBench.tasks.push(
          ...list
            .getEntries()
            .filter((e) => e.startTime >= window.__uiBench.start)
            .map((e) => e.duration),
        ),
      );
      observer.observe({ type: 'longtask' });
      window.__uiBench.observer = observer;
      function frame() {
        const now = performance.now();
        const m = window.__uiBench;
        m.maxGap = Math.max(m.maxGap, now - m.last);
        m.last = now;
        if (m.running) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    });
    await dialog.getByLabel('Backup file').setInputFiles({
      name: 'synthetic-10000.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(text),
    });
    await dialog.getByRole('button', { name: 'Review import', exact: true }).waitFor();
    await page.waitForFunction(() => {
      const b = [...document.querySelectorAll('button')].find(
        (b) => b.textContent.trim() === 'Review import',
      );
      return b && !b.disabled;
    });
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    const selected = await page.evaluate(() => ({
      milliseconds: performance.now() - window.__uiBench.start,
      frameGap: window.__uiBench.maxGap,
      textareaLength: document.querySelector('textarea').value.length,
    }));
    await page.evaluate(() => {
      window.__uiBench.previewStart = performance.now();
      window.__uiBench.maxGap = 0;
    });
    await dialog.getByRole('button', { name: 'Review import', exact: true }).click();
    await dialog.getByRole('heading', { name: '10000 valid cookies', exact: true }).waitFor();
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    const preview = await page.evaluate(() => {
      const m = window.__uiBench;
      m.running = false;
      m.observer.disconnect();
      return {
        milliseconds: performance.now() - m.previewStart,
        frameGap: m.maxGap,
        longTasks: m.tasks,
      };
    });
    if (index) records.push({ selected, preview });
    await page.close();
  }
  if (errors.length) throw new Error(errors.join('\n'));
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const report = {
    schemaVersion: 1,
    extensionVersion: manifest.version,
    browser: context.browser().version(),
    samples,
    warmups: 1,
    cpuThrottle: 1,
    syntheticRows: 10000,
    bytes: Buffer.byteLength(text),
    fixtureSha256: createHash('sha256').update(text).digest('hex'),
    upfrontTestHostGrants: true,
    temporaryProfile: true,
    medians: Object.fromEntries(
      ['selected', 'preview'].map((kind) => [
        kind,
        {
          milliseconds: +median(records.map((r) => r[kind].milliseconds)).toFixed(2),
          frameGap: +median(records.map((r) => r[kind].frameGap)).toFixed(2),
        },
      ]),
    ),
    records,
  };
  if (output) await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await context?.close();
  await rm(temporary, { recursive: true, force: true });
}
