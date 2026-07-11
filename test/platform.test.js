'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadPlatform({incognito = false, stores = []} = {}) {
    const browser = {
        extension: {inIncognitoContext: incognito},
        runtime: {},
        cookies: {getAllCookieStores: async () => stores},
        i18n: {getMessage: (key) => key},
    };
    const context = vm.createContext({browser, globalThis: null});
    context.globalThis = context;
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../src/platform.js'), 'utf8'), context);
    return context.vAPI;
}

test('private split contexts fall back to the private cookie store', async () => {
    const vAPI = loadPlatform({incognito: true});
    assert.equal(vAPI.currentContextStoreId(), '1');
    assert.equal(await vAPI.getTabCookieStoreId(99), '1');
});

test('an initialized context store takes precedence over platform defaults', () => {
    const vAPI = loadPlatform({incognito: true});
    vAPI.storeIds = ['container-7'];
    assert.equal(vAPI.currentContextStoreId(), 'container-7');
});
