import { chromium } from '@playwright/test';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const argument = (name, fallback) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
};
const build = resolve(argument('--build', 'apps/extension/.output/chrome-mv3'));
const output = argument('--output', undefined);
const samples = Number(argument('--samples', '7'));
const cookieCount = Number(argument('--cookies', '2000'));
if (!Number.isInteger(samples) || samples < 1 || samples > 30) throw new Error('Use 1–30 samples.');
if (!Number.isInteger(cookieCount) || cookieCount < 30 || cookieCount > 3000)
  throw new Error('Use 30–3000 cookies in a disposable Chromium profile.');
const temporary = await mkdtemp(join(tmpdir(), 'cookie-loom-benchmark-'));
const extension = join(temporary, 'extension');
let context;
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch: () => new Response('<!doctype html><title>Cookie Loom performance fixture</title>'),
});
const fixtureUrl = `http://127.0.0.1:${server.port}/`;

function median(values) {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

try {
  await cp(build, extension, { recursive: true });
  const originalManifest = await readFile(join(extension, 'manifest.json'));
  const manifest = JSON.parse(originalManifest);
  // All product code is unchanged. A disposable profile receives synthetic data
  // and upfront test-only host grants; permission dialogs are not benchmarked.
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
  await worker.evaluate(() => {
    globalThis.__loomMutationReads = { getAll: 0, records: 0, stores: 0 };
    for (const [method, metric] of [
      ['getAll', 'getAll'],
      ['getAllCookieStores', 'stores'],
    ]) {
      const original = chrome.cookies[method].bind(chrome.cookies);
      chrome.cookies[method] = (...args) => {
        globalThis.__loomMutationReads[metric]++;
        const result = original(...args);
        if (method === 'getAll' && result?.then)
          result.then((records) => {
            globalThis.__loomMutationReads.records += records.length;
          });
        return result;
      };
    }
  });
  const site = await context.newPage();
  await site.goto(fixtureUrl);
  const sourceTab = await worker.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((tab) => tab.url === url)?.id;
  }, fixtureUrl);
  if (sourceTab === undefined) throw new Error('Fixture source tab is missing.');
  const expiry = Math.floor(Date.now() / 1000) + 60 * 86400;
  await context.addCookies(
    Array.from({ length: cookieCount }, (_, index) => ({
      url: index < 30 ? fixtureUrl : `https://site${String(index).padStart(4, '0')}.test/`,
      name: `perf_${String(index).padStart(4, '0')}`,
      value: 'synthetic-benchmark-value',
      expires: expiry,
      httpOnly: true,
      sameSite: 'Lax',
    })),
  );
  if ((await context.cookies()).length !== cookieCount)
    throw new Error('Browser cookie quota changed the fixture.');
  await context.addInitScript(() => {
    window.__loomMetrics = { getAll: 0, stores: 0, records: 0, formatters: 0 };
    for (const [method, metric] of [
      ['getAll', 'getAll'],
      ['getAllCookieStores', 'stores'],
    ]) {
      const original = chrome.cookies[method].bind(chrome.cookies);
      chrome.cookies[method] = (...args) => {
        window.__loomMetrics[metric]++;
        const result = original(...args);
        if (method === 'getAll' && result?.then)
          result.then((records) => {
            window.__loomMetrics.records += records.length;
          });
        return result;
      };
    }
    Intl.DateTimeFormat = new Proxy(Intl.DateTimeFormat, {
      construct(target, args, newTarget) {
        window.__loomMetrics.formatters++;
        return Reflect.construct(target, args, newTarget);
      },
    });
  });
  const results = { workbench: [], search: [], edit: [], popup: [] };
  const api = { workbench: [], popup: [], edit: [] };
  const loadedScripts = { workbench: new Set(), popup: new Set() };
  const errors = [];
  async function open(kind) {
    const page = await context.newPage();
    let initial = true;
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('request', (r) => {
      const url = new URL(r.url());
      if (initial && url.protocol === 'chrome-extension:' && url.pathname.endsWith('.js'))
        loadedScripts[kind].add(url.pathname.slice(1));
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const query =
      kind === 'popup'
        ? `?sourceTab=${sourceTab}&sourceOrigin=${encodeURIComponent(new URL(fixtureUrl).origin)}`
        : '';
    await page.goto(`chrome-extension://${id}/${kind}.html${query}`);
    await page.waitForFunction(
      ({ kind, count }) => {
        const element = document.querySelector(
          kind === 'popup' ? '.popup-summary strong' : '.heading-count',
        );
        return element && parseInt(element.textContent) === count;
      },
      { kind, count: kind === 'popup' ? 30 : cookieCount },
    );
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    initial = false;
    return page;
  }
  for (let index = 0; index <= samples; index++) {
    const page = await open('workbench');
    if (index) {
      results.workbench.push(await page.evaluate(() => performance.now()));
      api.workbench.push(
        await page.evaluate(() => ({
          ...window.__loomMetrics,
          domainButtons: document.querySelectorAll('.domain-item').length,
        })),
      );
    }
    const target = `perf_${String(cookieCount - 1).padStart(4, '0')}`;
    await page.evaluate(() => {
      window.__loomSearchStarted = performance.now();
    });
    await page.getByRole('textbox', { name: 'Search cookies' }).fill(`name:${target}`);
    await page.waitForFunction((name) => {
      const rows = document.querySelectorAll('.cookie-table tbody tr');
      return rows.length === 1 && rows[0].textContent.includes(name);
    }, target);
    await page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    if (index)
      results.search.push(
        await page.evaluate(() => performance.now() - window.__loomSearchStarted),
      );
    await page.getByRole('button', { name: target, exact: true }).click();
    const editor = page.getByRole('complementary', { name: 'Cookie details' });
    await editor.getByLabel('Value', { exact: true }).fill(`synthetic-edit-${index}`);
    await worker.evaluate(() => {
      globalThis.__loomMutationReads = { getAll: 0, records: 0, stores: 0 };
    });
    await page.evaluate(() => {
      window.__loomEditStarted = performance.now();
    });
    await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
    await page.getByText('Cookie updated.', { exact: true }).waitFor();
    if (index) {
      results.edit.push(await page.evaluate(() => performance.now() - window.__loomEditStarted));
      api.edit.push(await worker.evaluate(() => globalThis.__loomMutationReads));
    }
    await page.close();
    const popup = await open('popup');
    if (index) {
      results.popup.push(await popup.evaluate(() => performance.now()));
      api.popup.push(await popup.evaluate(() => window.__loomMetrics));
    }
    await popup.close();
  }
  if (errors.length) throw new Error(errors.join('\n'));
  const report = {
    schemaVersion: 1,
    extensionVersion: manifest.version,
    platform: `${process.platform}-${process.arch}`,
    browser: context.browser().version(),
    bun: Bun.version,
    productionManifestSha256: createHash('sha256').update(originalManifest).digest('hex'),
    syntheticCookies: cookieCount,
    currentSiteCookies: 30,
    cpuThrottle: 4,
    samples,
    warmups: 1,
    upfrontTestHostGrants: true,
    temporaryProfile: true,
    milliseconds: Object.fromEntries(
      Object.entries(results).map(([key, values]) => [
        key,
        {
          median: Math.round(median(values) * 10) / 10,
          samples: values.map((v) => Math.round(v * 10) / 10),
        },
      ]),
    ),
    api,
    initialJavaScript: Object.fromEntries(
      await Promise.all(
        Object.entries(loadedScripts).map(async ([kind, files]) => [
          kind,
          {
            files: [...files],
            bytes: (
              await Promise.all([...files].map((file) => readFile(join(build, file))))
            ).reduce((sum, b) => sum + b.length, 0),
          },
        ]),
      ),
    ),
  };
  if (output) await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await context?.close();
  server.stop(true);
  await rm(temporary, { recursive: true, force: true });
}
