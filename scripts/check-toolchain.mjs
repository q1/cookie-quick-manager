import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const version = (await readFile(new URL('.bun-version', root), 'utf8')).trim();
const packageJson = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
if (packageJson.packageManager !== `bun@${version}` || packageJson.engines.bun !== version)
  throw new Error('Bun version pins disagree. Update .bun-version and package.json together.');
if (typeof Bun === 'undefined' || Bun.version !== version)
  throw new Error(`This project requires Bun ${version}. Install that version before building.`);
console.log(`Verified Bun ${version}.`);
