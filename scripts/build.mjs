import {cp, mkdir, readdir, rm} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const sourceDirectory = path.join(repositoryRoot, 'src');
const target = process.argv[2] || 'chromium';
const outputArgument = process.argv[3] || (target === 'firefox' ? 'build-firefox' : 'build');
const outputDirectory = path.resolve(repositoryRoot, outputArgument);

if (!['chromium', 'firefox'].includes(target))
    throw new Error(`Unknown build target: ${target}`);

const approvedOutputDirectories = new Map([
    ['chromium', path.join(repositoryRoot, 'build')],
    ['firefox', path.join(repositoryRoot, 'build-firefox')],
]);
if (path.isAbsolute(outputArgument) || outputArgument.split(/[\\/]+/).includes('..') ||
    outputDirectory !== approvedOutputDirectories.get(target))
    throw new Error(`Unsafe build output for ${target}: ${outputArgument}`);

await rm(outputDirectory, {recursive: true, force: true});
await mkdir(outputDirectory, {recursive: true});

for (const entry of await readdir(sourceDirectory, {withFileTypes: true})) {
    if (entry.name === 'manifest.firefox.json')
        continue;
    if (target === 'firefox' && entry.name === 'manifest.json')
        continue;
    await cp(
        path.join(sourceDirectory, entry.name),
        path.join(outputDirectory, entry.name),
        {recursive: entry.isDirectory()},
    );
}

if (target === 'firefox')
    await cp(path.join(sourceDirectory, 'manifest.firefox.json'), path.join(outputDirectory, 'manifest.json'));
await cp(path.join(repositoryRoot, 'LICENSE'), path.join(outputDirectory, 'LICENSE'));

console.log(`Built ${target} extension at ${path.relative(repositoryRoot, outputDirectory)}/`);
