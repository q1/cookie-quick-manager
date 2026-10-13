import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const output = join(root, 'apps/extension/.output');
const archive = join(output, `cookie-loom-${version}-sources.zip`);
const temporary = await mkdtemp(join(tmpdir(), 'cookie-loom-source-rebuild-'));
const source = join(temporary, 'source');

function extract(path, destination) {
  execFileSync('unzip', ['-tq', path], { stdio: 'inherit' });
  const entries = execFileSync('unzip', ['-Z1', path], { encoding: 'utf8' }).trim().split('\n');
  for (const entry of entries) {
    if (entry.startsWith('/') || entry.includes('\\') || entry.split('/').includes('..'))
      throw new Error(`Archive contains an unsafe path: ${entry}`);
  }
  execFileSync('unzip', ['-q', path, '-d', destination]);
}

async function inventory(directory, prefix = '') {
  const files = new Map();
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Unexpected symbolic link: ${path}`);
    if (entry.isDirectory()) {
      for (const [file, hash] of await inventory(join(directory, entry.name), path))
        files.set(file, hash);
    } else if (entry.isFile()) {
      files.set(
        path,
        createHash('sha256')
          .update(await readFile(join(directory, entry.name)))
          .digest('hex'),
      );
    } else throw new Error(`Unexpected file type: ${path}`);
  }
  return files;
}

try {
  await mkdir(source);
  extract(archive, source);
  execFileSync(process.execPath, ['install', '--frozen-lockfile', '--ignore-scripts'], {
    cwd: source,
    stdio: 'inherit',
    timeout: 300_000,
  });
  execFileSync(process.execPath, ['run', 'build'], {
    cwd: source,
    stdio: 'inherit',
    timeout: 300_000,
  });
  for (const browser of ['chrome', 'firefox']) {
    const original = await inventory(join(output, `${browser}-mv3`));
    const rebuilt = await inventory(join(source, 'apps/extension/.output', `${browser}-mv3`));
    const directory = join(temporary, browser);
    extract(join(output, `cookie-loom-${version}-${browser}.zip`), directory);
    const packaged = await inventory(directory);
    for (const [label, candidate] of [
      ['source rebuild', rebuilt],
      ['ZIP contents', packaged],
    ]) {
      if (original.size !== candidate.size)
        throw new Error(`${browser}: ${label} file counts differ.`);
      for (const [path, hash] of original)
        if (candidate.get(path) !== hash)
          throw new Error(`${browser}: ${label} does not reproduce ${path}.`);
    }
    console.log(
      `${browser}: source rebuild and ZIP match all ${original.size} files byte for byte.`,
    );
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
