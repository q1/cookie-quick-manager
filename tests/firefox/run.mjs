import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const production = join(root, 'apps/extension/.output/firefox-mv3');
const temporary = await mkdtemp(join(tmpdir(), 'cookie-loom-firefox-'));
const source = join(temporary, 'extension');
const token = randomUUID();
let child;
let server;
let timeout;
let output = '';
let reportReceived = false;
let rejectCompleted;

function capture(data) {
  output = `${output}${data}`.slice(-12_000);
  if (process.env.FIREFOX_VERBOSE) process.stderr.write(data);
}

async function firefoxBinary() {
  if (process.env.FIREFOX_BINARY) return process.env.FIREFOX_BINARY;
  const cache = join(homedir(), '.cache/ms-playwright');
  const versions = (await readdir(cache).catch(() => []))
    .filter((name) => /^firefox-\d+$/.test(name))
    .sort()
    .reverse();
  if (!versions[0])
    throw new Error('Set FIREFOX_BINARY or install the Playwright Firefox browser first.');
  return join(cache, versions[0], 'firefox/firefox');
}

try {
  const completed = new Promise((resolveResult, reject) => {
    rejectCompleted = reject;
    server = createServer(async (request, response) => {
      if (request.method !== 'POST' || request.url !== `/result/${token}`) {
        response.writeHead(404).end();
        return;
      }
      try {
        let data = '';
        for await (const chunk of request) {
          data += chunk;
          if (data.length > 1_000_000) throw new Error('Unexpectedly large Firefox test report.');
        }
        response
          .writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' })
          .end('received');
        reportReceived = true;
        resolveResult(JSON.parse(data));
      } catch (error) {
        response.writeHead(400).end();
        reject(error);
      }
    });
    timeout = setTimeout(
      () => reject(new Error(`Firefox did not report within 90 seconds.\n${output}`)),
      90_000,
    );
  });
  process.once('SIGINT', () => rejectCompleted(new Error('Firefox smoke test interrupted.')));
  process.once('SIGTERM', () => rejectCompleted(new Error('Firefox smoke test interrupted.')));
  await new Promise((resolveListening) => server.listen(0, '127.0.0.1', resolveListening));
  const address = server.address();
  const reportUrl = `http://127.0.0.1:${address.port}/result/${token}`;
  await cp(production, source, { recursive: true });
  const artifact = await readFile(join(source, 'manifest.json'));
  const background = await readFile(join(source, 'background.js'));
  const manifest = JSON.parse(artifact);
  // Only this disposable copy is changed. The full grant lets the unmodified
  // gateway perform its real permission check; test cookies use *.localhost.
  manifest.host_permissions = ['http://*/*', 'https://*/*'];
  manifest.permissions = [...new Set([...manifest.permissions, 'contextualIdentities'])];
  manifest.optional_permissions = manifest.optional_permissions.filter(
    (permission) => permission !== 'contextualIdentities',
  );
  manifest.background.scripts.push('native-firefox-fixture.js');
  await writeFile(join(source, 'manifest.json'), JSON.stringify(manifest));
  await build({
    configFile: false,
    root,
    logLevel: 'error',
    define: { __FIREFOX_REPORT_URL__: JSON.stringify(reportUrl) },
    resolve: { alias: { '@cookie-loom/core': join(root, 'packages/core/src/index.ts') } },
    build: {
      target: 'firefox140',
      outDir: source,
      emptyOutDir: false,
      minify: false,
      lib: {
        entry: join(root, 'tests/firefox/fixture.ts'),
        formats: ['iife'],
        name: 'CookieLoomNativeFixture',
        fileName: () => 'native-firefox-fixture.js',
      },
    },
  });
  const binary = await firefoxBinary();
  child = spawn(
    process.execPath,
    [
      join(root, 'node_modules/web-ext/bin/web-ext.js'),
      'run',
      '--source-dir',
      source,
      '--firefox',
      binary,
      '--firefox-profile',
      join(temporary, 'profile'),
      '--profile-create-if-missing',
      '--keep-profile-changes',
      '--no-input',
      '--no-reload',
      '--no-config-discovery',
      '--args=-headless',
      '--start-url=about:blank',
      '--pref=browser.shell.checkDefaultBrowser=false',
      '--pref=browser.startup.homepage=about:blank',
      '--pref=browser.newtabpage.enabled=false',
      '--pref=datareporting.healthreport.uploadEnabled=false',
      '--pref=toolkit.telemetry.enabled=false',
    ],
    {
      cwd: temporary,
      env: { ...process.env, MOZ_DISABLE_CONTENT_SANDBOX: '1' },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  child.on('error', (error) => capture(error.message));
  child.on('exit', () => {
    if (!reportReceived) rejectCompleted(new Error(`Firefox exited before reporting.\n${output}`));
  });
  const result = await completed;
  clearTimeout(timeout);
  const report = {
    ...result,
    productionManifestSha256: createHash('sha256').update(artifact).digest('hex'),
    productionBackgroundSha256: createHash('sha256').update(background).digest('hex'),
    temporaryProfile: true,
    productionManifestUnchanged: true,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!result.success) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  if (child?.pid) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      /* Already stopped. */
    }
    await Promise.race([
      new Promise((resolveExit) => child.once('exit', resolveExit)),
      new Promise((resolveWait) => setTimeout(resolveWait, 2_000)),
    ]);
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      /* Already stopped. */
    }
  }
  if (server) await new Promise((resolveClose) => server.close(resolveClose));
  await rm(temporary, { recursive: true, force: true });
}
