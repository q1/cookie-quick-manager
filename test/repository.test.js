'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));

test('package and browser manifests share one release version', () => {
    const packageJson = readJson('package.json');
    const chromiumManifest = readJson('src/manifest.json');
    const firefoxManifest = readJson('src/manifest.firefox.json');
    assert.equal(packageJson.version, chromiumManifest.version);
    assert.equal(packageJson.version, firefoxManifest.version);
    assert.equal(packageJson.version, chromiumManifest.version_name);
    assert.equal(packageJson.version, firefoxManifest.version_name);
});

test('browser manifests declare only their supported background model', () => {
    const chromium = readJson('src/manifest.json');
    const firefox = readJson('src/manifest.firefox.json');
    assert.equal(chromium.background.service_worker, 'service-worker.js');
    assert.equal(chromium.background.scripts, undefined);
    assert.ok(firefox.background.scripts.includes('background-script.js'));
    assert.equal(firefox.background.service_worker, undefined);
    assert.ok(firefox.permissions.includes('contextualIdentities'));
    assert.ok(firefox.permissions.includes('privacy'));
    assert.equal(firefox.browser_specific_settings.gecko.data_collection_permissions.required[0], 'none');
});

test('locales have complete key parity', () => {
    const englishKeys = Object.keys(readJson('src/_locales/en/messages.json')).sort();
    for (const locale of ['de', 'fr'])
        assert.deepEqual(Object.keys(readJson(`src/_locales/${locale}/messages.json`)).sort(), englishKeys,
            `${locale} locale keys differ from English`);
});

test('runtime source no longer depends on a generated browser polyfill', () => {
    for (const file of ['cookies.html', 'menu.html', 'options.html', 'service-worker.js']) {
        const content = fs.readFileSync(path.join(root, 'src', file), 'utf8');
        assert.equal(content.includes('browser-polyfill'), false, `${file} still references browser-polyfill`);
        assert.equal(content.includes('core.js'), true, `${file} does not load core.js`);
    }
});
