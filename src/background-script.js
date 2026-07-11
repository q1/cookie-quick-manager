/*
 *  Cookie Quick Manager: An addon to manage (view, search, create, edit,
 *  remove, backup, restore) cookies on Firefox.
 *  Copyright (C) 2017-2019 Ysard
 *
 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 *  Home: https://github.com/ysard/cookie-quick-manager
 */
'use strict';

(function(self) {
const core = self.CQMCore;
if (!core)
    throw new Error('CQMCore must be loaded before background-script.js');

let protectedCookies = {};
let preventProtectedCookieDeletion = true;
let deleteAllOnRestart = false;
const restoreTimers = new Map();

async function loadOptions() {
    const items = await browser.storage.local.get(null);
    protectedCookies = core.protectedCookiesFromStorage(items);
    preventProtectedCookieDeletion = items.prevent_protected_cookies_deletion !== false;
    deleteAllOnRestart = items.delete_all_on_restart === true;
    return items;
}

let optionsReady = loadOptions().catch((error) => {
    vAPI.onError(error);
    protectedCookies = {};
});

async function handleInstalled() {
    const info = await browser.runtime.getPlatformInfo();
    if (info.os === 'android')
        await browser.storage.local.set({open_in_new_tab: true});
}

async function runStartupCleanup() {
    await loadOptions();
    if (!deleteAllOnRestart)
        return {deleted: false};

    await vAPI.get_stores();
    const cookies = await vAPI.get_all_cookies();
    const protectedCount = await vAPI.delete_cookies(Promise.resolve(cookies));
    return {deleted: true, examined: cookies.length, protectedCount};
}

function cancelScheduledRestore(cookie) {
    const key = core.cookieIdentity(cookie);
    const timer = restoreTimers.get(key);
    if (timer !== undefined) {
        clearTimeout(timer);
        restoreTimers.delete(key);
    }
}

async function restoreCookieIfStillMissing(cookie) {
    // cookies.get() may return a host-only/domain sibling with the same name.
    // Query candidates and compare the complete CQM identity before deciding
    // that this exact protected cookie survived.
    const candidates = await vAPI.get_cookies(core.buildCookieQueryDetails(cookie));
    const identity = core.cookieIdentity(cookie);
    const existingCookie = candidates.find((candidate) => core.cookieIdentity(candidate) === identity);
    if (existingCookie)
        return existingCookie;
    return vAPI.set_cookie(core.buildCookieSetDetails(cookie));
}

function scheduleCookieRestore(cookie) {
    const key = core.cookieIdentity(cookie);
    cancelScheduledRestore(cookie);
    const timer = setTimeout(() => {
        restoreTimers.delete(key);
        restoreCookieIfStillMissing(cookie).catch(vAPI.onError);
    }, 150);
    restoreTimers.set(key, timer);
}

async function handleCookieChange(changeInfo) {
    await optionsReady;

    // A new value for the same exact cookie wins over a pending restore. This
    // prevents stale protected authentication state from replacing a rotation.
    if (!changeInfo.removed) {
        cancelScheduledRestore(changeInfo.cookie);
        return;
    }

    if (changeInfo.cause === 'overwrite') {
        cancelScheduledRestore(changeInfo.cookie);
        return;
    }

    // Natural expiry and browser eviction are lifecycle decisions, not a
    // site/API deletion. Restoring them would silently make cookies immortal.
    if (!['explicit', 'expired_overwrite'].includes(changeInfo.cause))
        return;

    if (!preventProtectedCookieDeletion || !core.isCookieProtected(changeInfo.cookie, protectedCookies))
        return;
    scheduleCookieRestore(changeInfo.cookie);
}

browser.runtime.onInstalled.addListener(() => {
    handleInstalled().catch(vAPI.onError);
});

browser.runtime.onStartup.addListener(() => {
    runStartupCleanup().catch(vAPI.onError);
});

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'cqm:update-protection')
        return false;
    if (sender.id !== browser.runtime.id) {
        sendResponse({ok: false, error: 'Untrusted message sender.'});
        return false;
    }
    if (!Array.isArray(message.cookies) || message.cookies.length > 10000 ||
        typeof message.protect !== 'boolean') {
        sendResponse({ok: false, error: 'Invalid protection update.'});
        return false;
    }
    const cookies = message.cookies.filter((cookie) => cookie &&
        typeof cookie.domain === 'string' && typeof cookie.name === 'string' &&
        typeof cookie.path === 'string' && typeof cookie.storeId === 'string');
    if (cookies.length !== message.cookies.length) {
        sendResponse({ok: false, error: 'Invalid cookie identity.'});
        return false;
    }
    vAPI.commit_cookie_protection(cookies, message.protect).then((updatedProtection) => {
        // Make the new policy visible before acknowledging the mutation so a
        // caller can safely delete immediately after protecting.
        protectedCookies = core.normalizeProtectedCookies(updatedProtection);
        sendResponse({ok: true, protectedCookies: {...protectedCookies}});
    }, (error) => {
        sendResponse({ok: false, error: error.message});
    });
    return true;
});

browser.cookies.onChanged.addListener((changeInfo) => {
    handleCookieChange(changeInfo).catch(vAPI.onError);
});

browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local')
        return;
    if (changes.protected_cookies !== undefined)
        optionsReady = loadOptions().catch(vAPI.onError);
    if (Object.keys(changes).some((key) => core.isProtectionStorageKey(key)))
        optionsReady = loadOptions().catch(vAPI.onError);
    if (changes.prevent_protected_cookies_deletion !== undefined)
        preventProtectedCookieDeletion = changes.prevent_protected_cookies_deletion.newValue !== false;
    if (changes.delete_all_on_restart !== undefined)
        deleteAllOnRestart = changes.delete_all_on_restart.newValue === true;
});

// Exposed for adapter contract tests; production code uses the listeners above.
self.CQMBackground = Object.freeze({
    handleCookieChange,
    loadOptions,
    restoreCookieIfStillMissing,
    runStartupCleanup,
});
})(globalThis);
