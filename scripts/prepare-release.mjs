import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'apps/extension/.output');
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const names = ['chrome', 'firefox', 'sources'].map((kind) => `cookie-loom-${version}-${kind}.zip`);
const actual = (await readdir(output)).filter((name) => name.endsWith('.zip'));
if (actual.length !== names.length || actual.some((name) => !names.includes(name)))
  throw new Error('Expected exactly the current Chrome, Firefox, and source archives.');

const assets = [];
for (const name of names) {
  execFileSync('unzip', ['-tq', join(output, name)], { stdio: 'inherit' });
  if (!name.endsWith('-sources.zip')) {
    const archivedManifest = execFileSync('unzip', ['-p', join(output, name), 'manifest.json']);
    const browser = name.endsWith('-chrome.zip') ? 'chrome' : 'firefox';
    const builtManifest = await readFile(join(output, `${browser}-mv3/manifest.json`));
    if (!archivedManifest.equals(builtManifest))
      throw new Error(`${browser}: archived manifest differs from the verified build.`);
  }
  const contents = await readFile(join(output, name));
  const budget = name.endsWith('-sources.zip') ? 500_000 : 95_000;
  if (contents.length > budget)
    throw new Error(`${name}: ${contents.length} bytes exceeds the ${budget}-byte package budget.`);
  assets.push({
    name,
    bytes: contents.length,
    sha256: createHash('sha256').update(contents).digest('hex'),
  });
}
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const metadata = {
  schemaVersion: 1,
  product: 'Cookie Loom',
  version,
  sourceCommit: commit,
  sourceUrl: `https://github.com/q1/cookie-quick-manager/tree/${commit}`,
  bunVersion: Bun.version,
  unsigned: true,
  ...(process.env.GITHUB_RUN_ID && process.env.GITHUB_REPOSITORY
    ? {
        buildRun: `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
      }
    : {}),
  assets,
};
const contents = Buffer.from(`${JSON.stringify(metadata, null, 2)}\n`);
await writeFile(join(output, 'RELEASE.json'), contents);
const sums = [
  ...assets.map(({ name, sha256 }) => `${sha256}  ${name}`),
  `${createHash('sha256').update(contents).digest('hex')}  RELEASE.json`,
];
await writeFile(join(output, 'SHA256SUMS'), `${sums.join('\n')}\n`);
console.log(`Prepared ${assets.length} unsigned archives, release metadata, and SHA256SUMS.`);
