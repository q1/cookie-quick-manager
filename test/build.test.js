'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const test = require('node:test');

const repositoryRoot = path.resolve(__dirname, '..');

test('build script rejects output paths outside the approved target directory', () => {
    for (const output of ['..', 'src', repositoryRoot]) {
        const result = spawnSync(process.execPath, ['scripts/build.mjs', 'chromium', output], {
            cwd: repositoryRoot,
            encoding: 'utf8',
        });
        assert.notEqual(result.status, 0, `unsafe output unexpectedly accepted: ${output}`);
        assert.match(result.stderr, /Unsafe build output/);
    }
});
