import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targets = [
    ['package', 'dist/cookie_quick_manager-chromium.zip'],
    ['package:firefox', 'dist/cookie_quick_manager-firefox.zip'],
];

function runScript(script) {
    const result = spawnSync('npm', ['run', script], {cwd: repositoryRoot, stdio: 'inherit'});
    if (result.error)
        throw result.error;
    if (result.status !== 0)
        throw new Error(`npm run ${script} exited with status ${result.status}`);
}

for (const [script, archive] of targets) {
    runScript(script);
    const first = await readFile(path.join(repositoryRoot, archive));
    runScript(script);
    const second = await readFile(path.join(repositoryRoot, archive));
    if (!first.equals(second))
        throw new Error(`${archive} is not reproducible`);
    console.log(`Verified reproducible package: ${archive}`);
}
