import { execFileSync } from 'node:child_process';
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
const tag = process.env.RELEASE_TAG;
const match = /^v(\d+\.\d+\.\d+)-preview\.([1-9]\d*)$/.exec(tag ?? '');
if (!match || match[1] !== version)
  throw new Error(`Release tag must be v${version}-preview.<positive integer>.`);
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
if (git('cat-file', '-t', `refs/tags/${tag}`) !== 'tag')
  throw new Error('Release tags must be annotated.');
if (git('rev-parse', `${tag}^{commit}`) !== git('rev-parse', 'HEAD'))
  throw new Error('Release tag must identify the checked-out commit.');
git('merge-base', '--is-ancestor', 'HEAD', 'origin/fpi');
await access(new URL(`../docs/releases/${tag}.md`, import.meta.url));
console.log(`Validated reviewed preview tag ${tag}.`);
