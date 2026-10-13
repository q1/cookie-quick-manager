import { chromium, firefox } from '@playwright/test';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

const argument = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
};
const output = argument('--output', undefined);
const browserName = argument('--browser', 'chromium');
const samples = Number(argument('--samples', '7'));
if (
  !['chromium', 'firefox'].includes(browserName) ||
  !Number.isInteger(samples) ||
  samples < 1 ||
  samples > 30
)
  throw new Error('Invalid browser or sample count.');
const root = resolve('experiments/rust-backup/dist');
const now = 2_000_000_000;
const options = { storeId: '0', now };
function fixture(count, length, unicode = false, json = false) {
  const records = Array.from({ length: count }, (_, index) => ({
    name: `synthetic_${index}${unicode ? '_😺' : ''}`,
    value: `${unicode ? 'café猫' : 'x'}${'v'.repeat(length)}`,
    domain: '.example.test',
    path: `/p/${index}`,
    storeId: '0',
    secure: true,
    httpOnly: true,
    hostOnly: false,
    session: true,
    sameSite: json ? 'lax' : 'unspecified',
  }));
  return json
    ? JSON.stringify({
        format: 'cookie-loom',
        version: 1,
        exportedAt: '2033-05-18T03:33:20.000Z',
        stores: [],
        cookies: records,
      })
    : '# Netscape HTTP Cookie File\n' +
        records
          .map((c) => `#HttpOnly_${c.domain}\tTRUE\t${c.path}\tTRUE\t0\t${c.name}\t${c.value}`)
          .join('\n');
}
const fixtures = [
  { name: 'netscape-2000', text: fixture(2000, 64) },
  { name: 'netscape-10000', text: fixture(10000, 850) },
  { name: 'unicode-2000', text: fixture(2000, 64, true) },
  { name: 'json-10000', text: fixture(10000, 650, false, true) },
];
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(request) {
    if (new URL(request.url).pathname === '/favicon.ico')
      return new Response(null, { status: 204 });
    const path = resolve(
      root,
      `.${new URL(request.url).pathname === '/' ? '/index.html' : new URL(request.url).pathname}`,
    );
    if (!path.startsWith(`${root}/`)) return new Response('Not found', { status: 404 });
    const file = Bun.file(path);
    if (!(await file.exists())) return new Response('Not found', { status: 404 });
    return new Response(file, {
      headers: {
        'Content-Security-Policy':
          "script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; worker-src 'self'",
        'Cache-Control': 'no-store',
      },
    });
  },
});
const url = `http://127.0.0.1:${server.port}`;
const launcher = browserName === 'firefox' ? firefox : chromium;
const errors = [];
let browser;
const results = [];
function canonical(value) {
  return Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, canonical(value[key])]),
        )
      : value;
}
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
function summarize(values) {
  return { median: +median(values).toFixed(2), samples: values.map((v) => +v.toFixed(2)) };
}

try {
  browser = await launcher.launch();
  const parityPage = await browser.newPage();
  await parityPage.goto(url);
  await parityPage.waitForFunction(() => !!window.loomLab);
  const parity = await parityPage.evaluate(
    async ({ url, options }) => {
      const rust = await window.loomLab.createRustImporter(`${url}/scanner.wasm`);
      function canonical(value) {
        return Array.isArray(value)
          ? value.map(canonical)
          : value && typeof value === 'object'
            ? Object.fromEntries(
                Object.keys(value)
                  .sort()
                  .map((key) => [key, canonical(value[key])]),
              )
            : value;
      }
      const cases = [
        '',
        '# comment\n',
        '\uFEFF\n\u2000',
        '\u0085',
        '#HttpOnly_.example.test\tTRUE\t/\tFALSE\t0\tcat😺\t',
        'example.test\tFALSE\t/account\tTRUE\t0\tname\t\ud800',
        '[{}]',
        '{"format":"cookie-loom","version":2}',
        'bad\n' + 'example.test\tFALSE\t/\tTRUE\t0\tunique\tvalue\n'.repeat(10001),
        '#HttpOnly_.example.test\tTRUE\t/\tTRUE\t0\tname\tvalue\n'.repeat(2),
        '#'.repeat(10 * 1024 * 1024 + 1),
      ];
      let seed = 73129;
      const random = (n) => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed % n;
      };
      const fields = [
        ['.example.test', 'example.test', '.münich.test', '127.0.0.1', '[::1]', 'bad/domain', ''],
        ['TRUE', 'FALSE', 'true', 'false', '0', ''],
        ['/', '/account', 'invalid', '/;', '/😺'],
        ['TRUE', 'FALSE', 'true', 'false', 'invalid'],
        ['0', '2000000050', '1', '01', 'NaN', '1.5', '1e3'],
        ['name', 'cat😺', '__Host-name', 'bad name', '', '\ud800'],
        ['value', 'café猫', '', 'bad;value', 'a\tb', '\u0000'],
      ];
      for (let i = 0; i < 500; i++) {
        const line =
          (random(2) ? '#HttpOnly_' : '') +
          fields.map((list) => list[random(list.length)]).join('\t');
        cases.push(
          `${random(2) ? '\uFEFF' : ''}# comment\r\n${line}${['\r', '\n', '\r\n'][random(3)]}${line}`,
        );
      }
      let checked = 0;
      for (const text of cases)
        for (const netscapeMode of ['standard', 'legacy-cqm']) {
          const next = { ...options, netscapeMode };
          const expected = window.loomLab.reference(text, next);
          const actual = rust.import(text, next);
          if (JSON.stringify(canonical(expected)) !== JSON.stringify(canonical(actual)))
            throw new Error(
              `Parity failed for ${JSON.stringify(text.slice(0, 200))}: ${JSON.stringify(expected)} vs ${JSON.stringify(actual)}`,
            );
          checked++;
        }
      rust.release();
      return checked;
    },
    { url, options },
  );
  await parityPage.close();
  for (const data of fixtures)
    for (const engine of ['main', 'worker', 'rust']) {
      const page = await browser.newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await page.goto(url);
      await page.waitForFunction(() => !!window.loomLab);
      const expectedHash = createHash('sha256')
        .update(
          JSON.stringify(
            canonical(
              await page.evaluate(({ text, options }) => window.loomLab.reference(text, options), {
                text: data.text,
                options,
              }),
            ),
          ),
        )
        .digest('hex');
      const times = [],
        compute = [],
        frames = [],
        tasks = [];
      let cold,
        memory = 0;
      for (let index = 0; index <= samples; index++) {
        const record = await page.evaluate(
          async ({ engine, text, options }) => {
            const longTasks = [];
            const observer =
              typeof PerformanceObserver !== 'undefined' &&
              PerformanceObserver.supportedEntryTypes.includes('longtask')
                ? new PerformanceObserver((list) =>
                    longTasks.push(...list.getEntries().map((entry) => entry.duration)),
                  )
                : undefined;
            observer?.observe({ type: 'longtask' });
            let last = performance.now(),
              maxGap = 0,
              running = true;
            function frame(now) {
              maxGap = Math.max(maxGap, now - last);
              last = now;
              if (running) requestAnimationFrame(frame);
            }
            await new Promise((done) => requestAnimationFrame(done));
            requestAnimationFrame(frame);
            const started = performance.now();
            const value = await window.loomLab.run(engine, text, options);
            const elapsed = performance.now() - started;
            await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
            await new Promise((done) => setTimeout(done, 0));
            running = false;
            observer?.disconnect();
            return { elapsed, maxGap, longTasks, ...value };
          },
          { engine, text: data.text, options },
        );
        const hash = createHash('sha256')
          .update(JSON.stringify(canonical(record.result)))
          .digest('hex');
        if (hash !== expectedHash)
          throw new Error(`${engine} returned a different complete preview for ${data.name}.`);
        if (!index) cold = { elapsed: record.elapsed, initMs: record.initMs };
        else {
          times.push(record.elapsed);
          compute.push(record.computeMs);
          frames.push(record.maxGap);
          tasks.push(record.longTasks.reduce((sum, n) => sum + n, 0));
        }
        memory = Math.max(memory, record.wasmMemoryBytes);
      }
      results.push({
        fixture: data.name,
        bytes: Buffer.byteLength(data.text),
        engine,
        rustUsed: engine === 'rust' && !data.name.startsWith('json'),
        resultSha256: expectedHash,
        cold,
        milliseconds: {
          total: summarize(times),
          compute: summarize(compute),
          maxFrameGap: summarize(frames),
          longTasks: summarize(tasks),
        },
        wasmMemoryBytes: memory,
      });
      await page.close();
    }
  if (errors.length) throw new Error(errors.join('\n'));
  const wasm = await readFile(`${root}/scanner.wasm`);
  const report = {
    schemaVersion: 1,
    browser: browserName,
    browserVersion: browser.version(),
    bun: Bun.version,
    platform: `${process.platform}-${process.arch}`,
    samples,
    warmups: 1,
    cpuThrottle: 1,
    differentialCases: parity,
    syntheticDataOnly: true,
    results,
    wasm: {
      bytes: wasm.length,
      gzipBytes: gzipSync(wasm, { level: 9 }).length,
      sha256: createHash('sha256').update(wasm).digest('hex'),
    },
    memoryNote:
      'Wasm linear memory includes its reserved pages; frame/long-task metrics measure only the UI page. Total worker/process memory is not measured by this report.',
  };
  if (output) await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  server.stop(true);
}
