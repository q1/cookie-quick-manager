import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const publicDirectory = resolve(root, 'apps/extension/public');
await mkdir(publicDirectory, { recursive: true });
let notices =
  '# Third-party notices\n\nThese notices cover code bundled in the Cookie Loom extension. Development tools\nretain their licenses in their installed packages. Update this file with\n`npm run prepare:assets` after dependency changes.\n\n';
for (const name of ['react', 'react-dom', 'scheduler', 'lucide-react', 'wxt', '@wxt-dev/browser']) {
  const directory = resolve(root, 'node_modules', name);
  const metadata = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
  const licensePath = ['wxt', '@wxt-dev/browser'].includes(name)
    ? resolve(root, 'licenses/wxt-MIT.txt')
    : resolve(directory, 'LICENSE');
  const license = await readFile(licensePath, 'utf8');
  notices += `## ${name} ${metadata.version}\n\nLicense: ${metadata.license}.\n\n\`\`\`text\n${license.trim()}\n\`\`\`\n\n`;
}
notices += 'WXT license source: https://github.com/wxt-dev/wxt/blob/main/LICENSE\n';
await writeFile(resolve(root, 'THIRD_PARTY_NOTICES.md'), notices);
await writeFile(resolve(publicDirectory, 'THIRD_PARTY_NOTICES.md'), notices);
for (const file of ['LICENSE', 'NOTICE', 'PRIVACY.md']) {
  await copyFile(resolve(root, file), resolve(publicDirectory, file));
}
console.log('Prepared bundled license, attribution, and privacy notices.');
