import {mkdir, readdir, rm, utimes} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2];
const targets = {
    chromium: {
        source: path.join(repositoryRoot, 'build'),
        archive: path.join(repositoryRoot, 'dist', 'cookie_quick_manager-chromium.zip'),
    },
    firefox: {
        source: path.join(repositoryRoot, 'build-firefox'),
        archive: path.join(repositoryRoot, 'dist', 'cookie_quick_manager-firefox.zip'),
    },
};
if (!Object.hasOwn(targets, target))
    throw new Error(`Unknown package target: ${target}`);

async function listFiles(directory, prefix = '') {
    const files = [];
    const entries = await readdir(directory, {withFileTypes: true});
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
    for (const entry of entries) {
        const relativePath = path.join(prefix, entry.name);
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory())
            files.push(...await listFiles(absolutePath, relativePath));
        else if (entry.isFile())
            files.push(relativePath);
        else
            throw new Error(`Unsupported package entry: ${relativePath}`);
    }
    return files;
}

const {source, archive} = targets[target];
const files = await listFiles(source);
const stableTimestamp = new Date('2000-01-01T00:00:00.000Z');
await Promise.all(files.map((file) => utimes(path.join(source, file), stableTimestamp, stableTimestamp)));
await mkdir(path.dirname(archive), {recursive: true});
await rm(archive, {force: true});

const result = spawnSync('zip', ['-X', '-q', archive, ...files], {
    cwd: source,
    env: {...process.env, TZ: 'UTC'},
    stdio: 'inherit',
});
if (result.error)
    throw result.error;
if (result.status !== 0)
    throw new Error(`zip exited with status ${result.status}`);

console.log(`Packaged ${target} extension at ${path.relative(repositoryRoot, archive)}`);
