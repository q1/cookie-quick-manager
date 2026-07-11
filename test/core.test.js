'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const core = require('../src/core.js');

function cookie(overrides = {}) {
    return {
        domain: 'example.com',
        hostOnly: true,
        path: '/',
        name: 'session',
        value: 'value',
        storeId: '0',
        secure: false,
        httpOnly: false,
        sameSite: 'lax',
        session: true,
        ...overrides,
    };
}

test('boolean parser accepts standard case-insensitive cookie-file flags', () => {
    assert.equal(core.parseBoolean(' TRUE '), true);
    assert.equal(core.parseBoolean('FALSE', true), false);
    assert.equal(core.parseBoolean('not-a-flag', true), true);
});

test('cookie URLs normalize domain scope without corrupting hosts', () => {
    assert.equal(core.getCookieUrl(cookie({domain: '.example.com', path: '/account', secure: true})),
        'https://example.com/account');
    assert.equal(core.getCookieUrl(cookie({domain: '192.168.1.110'})), 'http://192.168.1.110/');
    assert.equal(core.getCookieUrl(cookie({domain: '::1'})), 'http://[::1]/');
    assert.equal(core.getCookieUrl(cookie({path: '/literal?#'})), 'http://example.com/literal%3F%23');
    assert.equal(core.normalizeDomain('EXAMPLE.COM'), 'example.com');
    assert.equal(core.normalizeDomain('b\u00fccher.example'), 'xn--bcher-kva.example');
    assert.throws(() => core.normalizeDomain('example.com\\attacker.test'), /invalid/);
    assert.throws(() => core.getCookieUrl(cookie({domain: 'example.com@attacker.test'})), /invalid/);
});

test('exact deletion uses a scoped expiry tombstone', () => {
    assert.deepEqual(core.buildCookieDeletionDetails(cookie({
        domain: '.example.com',
        hostOnly: false,
        path: '/literal?#',
        secure: true,
        partitionKey: {topLevelSite: 'https://top.example'},
    })), {
        url: 'https://example.com/',
        name: 'session',
        value: '',
        path: '/literal?#',
        secure: true,
        expirationDate: 1,
        storeId: '0',
        partitionKey: {topLevelSite: 'https://top.example'},
        domain: 'example.com',
    });
});

test('nameless deletion tombstones retain the value needed to identify the cookie', () => {
    const details = core.buildCookieDeletionDetails(cookie({name: '', value: 'nameless'}));
    assert.equal(details.name, '');
    assert.equal(details.value, 'nameless');
    assert.equal(details.expirationDate, 1);
});

test('set details preserve domain, security, expiry, store, and partition attributes', () => {
    const details = core.buildCookieSetDetails(cookie({
        domain: '.example.com',
        hostOnly: false,
        secure: true,
        httpOnly: true,
        sameSite: 'strict',
        session: false,
        expirationDate: 2000,
        partitionKey: {topLevelSite: 'https://top.example', hasCrossSiteAncestor: true},
    }), {now: 1000});
    assert.deepEqual(details, {
        url: 'https://example.com/',
        name: 'session',
        value: 'value',
        path: '/',
        httpOnly: true,
        secure: true,
        storeId: '0',
        partitionKey: {topLevelSite: 'https://top.example', hasCrossSiteAncestor: true},
        domain: 'example.com',
        sameSite: 'strict',
        expirationDate: 2000,
    });
    assert.equal(core.buildCookieSetDetails(cookie()).domain, undefined);
    assert.equal(core.buildCookieSetDetails(cookie({sameSite: 'no_restriction'})).sameSite, undefined);
    assert.throws(() => core.buildCookieSetDetails(cookie({session: false, expirationDate: 900}), {now: 1000}),
        /expiration must be in the future/);
});

test('exact queries preserve browser IPv6 domain notation and unusual paths', () => {
    assert.deepEqual(core.buildCookieQueryDetails(cookie({
        domain: '[::1]', path: '/literal?#', name: '',
    })), {
        domain: '[::1]', name: '', path: '/literal?#', storeId: '0',
    });
});

test('exact queries carry store, FPI, and partition scope without a URL selector', () => {
    assert.deepEqual(core.buildCookieQueryDetails(cookie({
        domain: '.example.com',
        hostOnly: false,
        path: '/app',
        firstPartyDomain: 'first.example',
        partitionKey: {topLevelSite: 'https://top.example', hasCrossSiteAncestor: true},
    })), {
        domain: 'example.com',
        name: 'session',
        path: '/app',
        storeId: '0',
        firstPartyDomain: 'first.example',
        partitionKey: {topLevelSite: 'https://top.example', hasCrossSiteAncestor: true},
    });
});

test('set details reconstruct the exact requested host/domain scope', () => {
    assert.deepEqual(core.cookieScopeFromSetDetails({
        url: 'https://sub.example.com/app', name: 'sid', path: '/', storeId: '0', secure: true,
    }), {
        domain: 'sub.example.com', hostOnly: true, path: '/', name: 'sid', storeId: '0', secure: true,
    });
    assert.equal(core.cookieScopeFromSetDetails({
        url: 'https://sub.example.com/', domain: 'example.com', name: 'sid', path: '/', storeId: '0',
    }).domain, '.example.com');
    assert.equal(core.cookieScopeFromSetDetails({
        url: 'https://sub.example.com/', name: 'sid', path: '/literal?#', storeId: '0',
    }).path, '/literal%3F%23');
});

test('search parser supports escaped quotes and documented OR/AND filtering', () => {
    const query = core.parseSearchQuery('example.com :name:"sid" :name:"auth\\"token" :value:"yes"');
    assert.deepEqual(query, {
        domain: 'example.com',
        names: ['sid', 'auth"token'],
        values: ['yes'],
    });
    const cookies = [
        cookie({name: 'sid-main', value: 'yes'}),
        cookie({name: 'auth"token', value: 'no'}),
        cookie({name: 'other', value: 'yes'}),
    ];
    assert.deepEqual(core.filterCookies(cookies, query).map((item) => item.name), ['sid-main']);
});

test('site-specific filtering includes applicable parent-domain cookies only', () => {
    const cookies = [
        cookie({domain: 'sub.example.com', name: 'host'}),
        cookie({domain: '.example.com', hostOnly: false, name: 'parent'}),
        cookie({domain: 'example.com', hostOnly: true, name: 'host-only-parent'}),
        cookie({domain: 'other.example.com', name: 'sibling'}),
        cookie({domain: 'notexample.com', name: 'substring'}),
    ];
    assert.deepEqual(core.filterCookies(cookies, {hostname: 'sub.example.com'}).map((item) => item.name),
        ['host', 'parent']);
});

test('exact protection distinguishes path, store, host scope, and partition', () => {
    const rootCookie = cookie();
    const pathCookie = cookie({path: '/app'});
    const storeCookie = cookie({storeId: '1'});
    const partitionedCookie = cookie({partitionKey: {topLevelSite: 'https://top.example'}});
    const storage = {
        [core.protectionStorageKey(rootCookie)]: {
            domain: rootCookie.domain,
            record: core.makeProtectionRecord(rootCookie),
        },
    };
    const protectedCookies = core.protectedCookiesFromStorage(storage);
    assert.equal(core.isCookieProtected(rootCookie, protectedCookies), true);
    assert.equal(core.isCookieProtected(pathCookie, protectedCookies), false);
    assert.equal(core.isCookieProtected(storeCookie, protectedCookies), false);
    assert.equal(core.isCookieProtected(partitionedCookie, protectedCookies), false);
});

test('legacy partition protection treats a missing ancestor flag as a migration wildcard', () => {
    const legacyPartition = cookie({partitionKey: {topLevelSite: 'https://top.example'}});
    const currentPartition = cookie({
        partitionKey: {topLevelSite: 'https://top.example', hasCrossSiteAncestor: false},
    });
    const protectedCookies = core.updateProtectionMap({}, [legacyPartition], true);
    assert.equal(core.isCookieProtected(currentPartition, protectedCookies), true);
    assert.equal(core.isCookieProtected(cookie({
        partitionKey: {topLevelSite: 'https://top.example', hasCrossSiteAncestor: true},
    }), protectedCookies), true);
    const explicitFalse = core.updateProtectionMap({}, [currentPartition], true);
    assert.equal(core.isCookieProtected(cookie({
        partitionKey: {topLevelSite: 'https://top.example', hasCrossSiteAncestor: true},
    }), explicitFalse), false);
});

test('legacy protection remains readable while exact records avoid lost-key updates', () => {
    const legacy = core.protectedCookiesFromStorage({protected_cookies: {'example.com': ['session']}});
    assert.equal(core.isCookieProtected(cookie({path: '/app'}), legacy), true);

    const first = cookie({name: 'first'});
    const second = cookie({name: 'second'});
    const independentUpdates = {
        [core.protectionStorageKey(first)]: {domain: first.domain, record: core.makeProtectionRecord(first)},
        [core.protectionStorageKey(second)]: {domain: second.domain, record: core.makeProtectionRecord(second)},
    };
    const merged = core.protectedCookiesFromStorage(independentUpdates);
    assert.equal(core.isCookieProtected(first, merged), true);
    assert.equal(core.isCookieProtected(second, merged), true);
});

test('legacy JSON domain-cookie URLs are repaired before mutation', () => {
    const details = core.parseJsonCookieRecord({
        'Host raw': 'https://.example.com/path',
        'Name raw': 'quoted',
        'Content raw': 'line 1\n"quoted"\\tail',
        'Path raw': '/path',
        'Expires raw': '0',
        'Send for raw': 'true',
        'HTTP only raw': 'true',
        'SameSite raw': 'strict',
        'This domain only raw': 'false',
        'Store raw': '0',
        'First Party Domain': '',
    });
    assert.equal(details.url, 'https://example.com/path');
    assert.equal(details.domain, 'example.com');
    assert.equal(details.value, 'line 1\n"quoted"\\tail');
    assert.equal(details.sameSite, 'strict');
});

test('Firefox FPI imports default a missing first-party domain to empty', () => {
    const details = core.parseJsonCookieRecord({
        'Host raw': 'https://example.com/',
        'Name raw': 'legacy',
        'Content raw': 'value',
        'Path raw': '/',
        'Expires raw': '0',
        'This domain only raw': 'true',
    }, {supportsFirstPartyIsolation: true});
    assert.equal(details.firstPartyDomain, '');
});

test('expired persistent JSON cookies are rejected instead of becoming session cookies', () => {
    assert.throws(() => core.parseJsonCookieRecord({
        'Host raw': 'https://example.com/',
        'Name raw': 'expired',
        'Content raw': 'value',
        'Path raw': '/',
        'Expires raw': '1',
        'Send for raw': 'true',
        'HTTP only raw': 'false',
        'This domain only raw': 'true',
    }), /expiration must be in the future/);
});

test('nameless cookies remain importable and protectable', () => {
    const details = core.parseJsonCookieRecord({
        'Host raw': 'https://example.com/',
        'Name raw': '',
        'Content raw': 'value',
        'Path raw': '/',
        'Expires raw': '0',
        'Send for raw': 'TRUE',
        'HTTP only raw': 'FALSE',
        'This domain only raw': 'TRUE',
        'Store raw': '0',
    });
    assert.equal(details.name, '');
    const nameless = cookie({name: ''});
    const protectedCookies = core.updateProtectionMap({}, [nameless], true);
    assert.equal(core.isCookieProtected(nameless, protectedCookies), true);
});

test('settings restore drops executable or unknown values', () => {
    const clean = core.sanitizeSettings({
        skin: 'https://attacker.test/theme',
        template: 'JSON',
        display_deletion_alert: true,
        unknown: '<script>bad()</script>',
        addonSize: {width: 1000, height: 700},
    });
    assert.deepEqual(clean, {
        display_deletion_alert: true,
        template: 'JSON',
        addonSize: {width: 1000, height: 700},
    });
});
