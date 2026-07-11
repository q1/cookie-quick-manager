'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const core = require('../src/core.js');

function eventTarget() {
    const listeners = [];
    return {
        listeners,
        addListener(listener) { listeners.push(listener); },
    };
}

function createBackgroundHarness(options = {}) {
    const targetCookie = {
        domain: 'example.com', hostOnly: true, path: '/', name: 'sid', value: 'old',
        storeId: '0', secure: true, httpOnly: true, sameSite: 'strict', session: true,
    };
    const storage = {
        ...core.getDefaultSettings(),
        delete_all_on_restart: options.deleteAllOnRestart === true,
        ...(options.protected ? {
            [core.protectionStorageKey(targetCookie)]: {
                domain: targetCookie.domain,
                record: core.makeProtectionRecord(targetCookie),
            },
        } : {}),
    };
    const events = {
        installed: eventTarget(), startup: eventTarget(), message: eventTarget(),
        cookieChanged: eventTarget(), storageChanged: eventTarget(),
    };
    const calls = {cleanup: 0, sets: [], errors: []};
    let currentCookies = [];
    let nextTimerId = 1;
    const pendingTimers = new Map();
    const scheduleTimer = (callback) => {
        const id = nextTimerId++;
        pendingTimers.set(id, callback);
        return id;
    };
    const cancelTimer = (id) => pendingTimers.delete(id);
    const browser = {
        runtime: {
            id: 'test-extension',
            getPlatformInfo: async () => ({os: 'linux'}),
            onInstalled: events.installed,
            onStartup: events.startup,
            onMessage: events.message,
        },
        storage: {
            local: {
                get: async () => structuredClone(storage),
                set: async (values) => Object.assign(storage, structuredClone(values)),
            },
            onChanged: events.storageChanged,
        },
        cookies: {
            getAll: async () => structuredClone(currentCookies),
            set: async (details) => {
                calls.sets.push(details);
                currentCookies = [details];
                return details;
            },
            onChanged: events.cookieChanged,
        },
    };
    const vAPI = {
        onError: (error) => calls.errors.push(error),
        get_stores: async () => [],
        get_all_cookies: async () => [targetCookie],
        get_cookies: async () => structuredClone(currentCookies),
        set_cookie: async (details) => browser.cookies.set(details),
        delete_cookies: async () => { calls.cleanup += 1; return 0; },
        commit_cookie_protection: async () => ({}),
    };
    const context = vm.createContext({
        browser, CQMCore: core, console, globalThis: null,
        setTimeout: scheduleTimer, clearTimeout: cancelTimer, vAPI,
    });
    context.globalThis = context;
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../src/background-script.js'), 'utf8'), context);
    return {
        background: context.CQMBackground,
        calls,
        events,
        async flushRestoreTimers() {
            const callbacks = [...pendingTimers.values()];
            pendingTimers.clear();
            callbacks.forEach((callback) => callback());
            await new Promise((resolve) => setImmediate(resolve));
        },
        setCurrentCookie(value) { currentCookies = value ? [value] : []; },
        setCurrentCookies(value) { currentCookies = value; },
        targetCookie,
    };
}

test('worker evaluation never performs startup cleanup', async () => {
    const harness = createBackgroundHarness({deleteAllOnRestart: true});
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(harness.calls.cleanup, 0);
    assert.equal(harness.events.startup.listeners.length, 1);
    await harness.background.runStartupCleanup();
    assert.equal(harness.calls.cleanup, 1);
});

test('protected cookie restore preserves exact security and domain semantics', async () => {
    const harness = createBackgroundHarness({protected: true});
    await harness.background.handleCookieChange({removed: true, cause: 'explicit', cookie: harness.targetCookie});
    await harness.flushRestoreTimers();
    assert.equal(harness.calls.sets.length, 1);
    assert.equal(harness.calls.sets[0].sameSite, 'strict');
    assert.equal(harness.calls.sets[0].httpOnly, true);
    assert.equal(harness.calls.sets[0].url, 'https://example.com/');
});

test('a host/domain sibling does not suppress restoration of the exact protected cookie', async () => {
    const harness = createBackgroundHarness({protected: true});
    harness.setCurrentCookies([{
        ...harness.targetCookie,
        domain: '.example.com',
        hostOnly: false,
        value: 'surviving-domain-sibling',
    }]);
    await harness.background.handleCookieChange({
        removed: true,
        cause: 'explicit',
        cookie: harness.targetCookie,
    });
    await harness.flushRestoreTimers();
    assert.equal(harness.calls.sets.length, 1);
    assert.equal(harness.calls.sets[0].domain, undefined);
    assert.equal(harness.calls.sets[0].value, 'old');
});

test('fresh cookie rotation cancels a pending stale restore', async () => {
    const harness = createBackgroundHarness({protected: true});
    await harness.background.handleCookieChange({removed: true, cause: 'explicit', cookie: harness.targetCookie});
    const freshCookie = {...harness.targetCookie, value: 'fresh'};
    harness.setCurrentCookie(freshCookie);
    await harness.background.handleCookieChange({removed: false, cause: 'explicit', cookie: freshCookie});
    await harness.flushRestoreTimers();
    assert.equal(harness.calls.sets.length, 0);
});

test('natural cookie expiry is not restored as an immortal session cookie', async () => {
    const harness = createBackgroundHarness({protected: true});
    await harness.background.handleCookieChange({removed: true, cause: 'expired', cookie: harness.targetCookie});
    await harness.flushRestoreTimers();
    assert.equal(harness.calls.sets.length, 0);
});

test('website expiry tombstones restore protected cookies', async () => {
    const harness = createBackgroundHarness({protected: true});
    await harness.background.handleCookieChange({
        removed: true,
        cause: 'expired_overwrite',
        cookie: harness.targetCookie,
    });
    await harness.flushRestoreTimers();
    assert.equal(harness.calls.sets.length, 1);
});

test('protection RPC rejects non-extension senders', () => {
    const harness = createBackgroundHarness();
    const listener = harness.events.message.listeners[0];
    let response;
    const keepChannelOpen = listener({type: 'cqm:update-protection', cookies: [], protect: true},
        {id: 'another-extension'}, (value) => { response = value; });
    assert.equal(keepChannelOpen, false);
    assert.equal(response.ok, false);
    assert.equal(response.error, 'Untrusted message sender.');
});
