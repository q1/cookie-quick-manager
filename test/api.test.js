'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const core = require('../src/core.js');

function createApiHarness(initialStorage = {}) {
    const storage = structuredClone(initialStorage);
    const cookieSets = [];
    const browser = {
        cookies: {
            getAll: async () => [],
            getAllCookieStores: async () => [],
            remove: async (details) => details,
            set: async (details) => {
                cookieSets.push(details);
                return details;
            },
        },
        storage: {
            local: {
                get: async (keys) => {
                    if (keys === null || keys === undefined)
                        return structuredClone(storage);
                    const result = {...keys};
                    for (const key of Object.keys(keys)) {
                        if (Object.hasOwn(storage, key))
                            result[key] = structuredClone(storage[key]);
                    }
                    return result;
                },
                set: async (values) => Object.assign(storage, structuredClone(values)),
                remove: async (keys) => {
                    for (const key of Array.isArray(keys) ? keys : [keys])
                        delete storage[key];
                },
            },
        },
        runtime: {sendMessage: async () => ({ok: true, protectedCookies: {}})},
        permissions: {request: async () => true, remove: async () => true},
    };
    const context = vm.createContext({
        browser,
        CQMCore: core,
        console,
        globalThis: null,
        URL,
    });
    context.globalThis = context;
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../src/api.js'), 'utf8'), context);
    return {vAPI: context.vAPI, storage, cookieSets};
}

function identity(overrides = {}) {
    return {
        domain: 'example.com',
        hostOnly: true,
        path: '/',
        name: 'sid',
        storeId: '0',
        ...overrides,
    };
}

test('concurrent exact protection writes retain every cookie', async () => {
    const {vAPI, storage} = createApiHarness();
    const first = identity({name: 'first'});
    const second = identity({name: 'second'});
    await Promise.all([
        vAPI.commit_cookie_protection([first], true),
        vAPI.commit_cookie_protection([second], true),
    ]);
    assert.ok(storage[core.protectionStorageKey(first)]);
    assert.ok(storage[core.protectionStorageKey(second)]);
});

test('unprotect removes a legacy partition record whose ancestor flag was absent', async () => {
    const legacy = identity({partitionKey: {topLevelSite: 'https://top.example'}});
    const current = identity({
        partitionKey: {topLevelSite: 'https://top.example', hasCrossSiteAncestor: true},
    });
    const legacyKey = core.protectionStorageKey(legacy);
    const harness = createApiHarness({
        [legacyKey]: {domain: legacy.domain, record: core.makeProtectionRecord(legacy)},
    });
    await harness.vAPI.commit_cookie_protection([current], false);
    assert.equal(harness.storage[legacyKey], undefined);
});

test('bulk deletion skips only the exact protected identity', async () => {
    const protectedCookie = identity({path: '/'});
    const otherPath = identity({path: '/app'});
    const storage = {
        [core.protectionStorageKey(protectedCookie)]: {
            domain: protectedCookie.domain,
            record: core.makeProtectionRecord(protectedCookie),
        },
    };
    const harness = createApiHarness(storage);
    const remaining = await harness.vAPI.delete_cookies(Promise.resolve([protectedCookie, otherPath]));
    assert.equal(remaining, 1);
    assert.equal(harness.cookieSets.length, 1);
    assert.equal(harness.cookieSets[0].url, 'http://example.com/');
    assert.equal(harness.cookieSets[0].path, '/app');
    assert.equal(harness.cookieSets[0].expirationDate, 1);
});
