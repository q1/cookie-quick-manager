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

if ( self.vAPI === undefined ) {
    self.vAPI = {};
}

var vAPI = self.vAPI;
var core = self.CQMCore;

if (!core)
    throw new Error('CQMCore must be loaded before api.js');

vAPI.onError = function(error) {
    // Function called when a save/remove function has failed by throwing an exception.
    console.log({"Error removing/saving cookie:": error});
}

vAPI.onSet = function(result) {
    if (result) {
        console.log("option set success");
    } else {
        console.log("option set failure");
    }
}

vAPI.parse_search_query = function(search_query) {
    /* Parse search queries like:
     * 'domain1.com domain2.com :value:"value1" :name:"name1" :name:"name2" :value:"value2"'
     * Set these 3 values in VAPI:
     *      vAPI.query_domain = "domain1.com";
     *      vAPI.query_names = ["name1", "name2];
     *      vAPI.query_values = ["value1", "value2"];
     * PS: A space separator is not mandatory between expressions
     * PS: If multiple domains are present, for the moment we keep only the first one
     */

    const query = core.parseSearchQuery(search_query);
    vAPI.query_domain = query.domain;
    vAPI.query_names = query.names;
    vAPI.query_values = query.values;
    return query;
}

vAPI.filter_cookies = function(promise) {
    /* Promise to filter cookies on their names and values
     * Return a cookie list satisfying the search conditions
     *
     * This promise is used with get_all_cookies()
     * and getCookiesFromSelectedDomain()
     *
     * This promise uses vAPI.query_names and vAPI.query_values set by vAPI.parse_search_query
     *
     * Multiple name filters are linked by OR operator.
     * Multiple value filters are linked by OR operator.
     * Groups of name filters are linked with groups of value filters by a AND operator.
     *
     * Ex: ("name1" OR "name2") AND ("value1", "value2")
     */

    return Promise.resolve(promise).then((cookies) => core.filterCookies(cookies, {
        domain: '',
        hostname: vAPI.query_hostname || '',
        names: vAPI.query_names || [],
        values: vAPI.query_values || [],
    }));
}

vAPI.get_all_cookies = async function(storeIds) {
    // Return a Promise with all cookies in all stores
    // Handle multiple stores:
    // - by default ALL previously queried stores are used,
    // (if no store has been queried use only default & private stores);
    // - otherwise uses storeIds argument.
    // Used by export.js on #clipboard_domain_export click event

    if (!Array.isArray(storeIds) || storeIds[0] === 'all')
        storeIds = vAPI.storeIds;

    if (!Array.isArray(storeIds) || !storeIds.length)
        return [];

    const cookieArrays = await Promise.all(storeIds.map((storeId) => {
        const details = {storeId};
        if (vAPI.supportsFirstPartyIsolation)
            details.firstPartyDomain = null;
        return vAPI.get_cookies(details);
    }));
    const cookies = cookieArrays.flat();
    return core.filterCookies(cookies, {
        domain: vAPI.query_domain || '',
        hostname: vAPI.query_hostname || '',
        names: [],
        values: [],
    });
}

vAPI.set_cookie = async function(details) {
    const effectiveDetails = {...details};
    if (!effectiveDetails.storeId)
        effectiveDetails.storeId = vAPI.currentContextStoreId();
    const setResult = await browser.cookies.set(effectiveDetails);

    // Chromium can return an applicable parent-domain sibling instead of the
    // exact host-only cookie just written. Resolve the requested scope before
    // callers protect or otherwise act on the returned identity.
    const canonicalDetails = {...effectiveDetails};
    if (setResult?.storeId)
        canonicalDetails.storeId = setResult.storeId;
    if (setResult?.partitionKey)
        canonicalDetails.partitionKey = setResult.partitionKey;
    if (typeof setResult?.firstPartyDomain === 'string')
        canonicalDetails.firstPartyDomain = setResult.firstPartyDomain;
    const expected = core.cookieScopeFromSetDetails(canonicalDetails);
    const candidates = await vAPI.get_cookies(core.buildCookieQueryDetails(expected));
    const identity = core.cookieIdentity(expected);
    return candidates.find((candidate) => core.cookieIdentity(candidate) === identity) || null;
}

vAPI.remove_cookie = async function(cookie) {
    const identity = core.cookieIdentity(cookie);
    // cookies.remove() cannot express hostOnly/domain identity and may remove
    // multiple applicable siblings. An expired set operation carries the full
    // cookie key, so it removes only the selected scope.
    await browser.cookies.set(core.buildCookieDeletionDetails(cookie));
    const candidates = await vAPI.get_cookies(core.buildCookieQueryDetails(cookie));
    return candidates.some((candidate) => core.cookieIdentity(candidate) === identity) ? null : cookie;
}

vAPI.get_cookies = async function(details = {}) {
    const queries = [browser.cookies.getAll(details)];
    if (vAPI.supportsPartitionedCookies && details.partitionKey === undefined)
        queries.push(browser.cookies.getAll({...details, partitionKey: {}}));

    const cookies = (await Promise.all(queries)).flat();
    const uniqueCookies = new Map();
    for (const cookie of cookies)
        uniqueCookies.set(core.cookieIdentity(cookie), cookie);
    return [...uniqueCookies.values()];
}

vAPI.get_stores = async function() {
    // Set stores & vAPI.storeIds
    // Return a promise with stores
    // TODO make a function to acess to vAPI.storeIds as private attribute

    const allowed_incognito_access = await browser.extension.isAllowedIncognitoAccess();
    vAPI.storesAllowed = allowed_incognito_access ? vAPI.default_stores : [vAPI.default_stores[0]];
    const contexts_or_cookie_stores = vAPI.supportsContextualIdentities ?
        await browser.contextualIdentities.query({}) :
        await browser.cookies.getAllCookieStores();
            // contexts === false on Firefox < 57
            // on FF57- contexts doesn't contain default stores: firefox-private or firefox-default
            //console.log({CONTEXTS: contexts});

            let stores;
            if (vAPI.supportsContextualIdentities) {
                // Init stores with default stores
                stores = vAPI.storesAllowed;
                //console.log({storesAllowed: vAPI.storesAllowed});

                if (contexts_or_cookie_stores !== false) {
                    // Replace 'resource://usercontext-content' prefix in the urls of the context icons
                    // Due to unsolved bug https://bugzilla.mozilla.org/show_bug.cgi?id=1499000
                    for (let context of contexts_or_cookie_stores) {
                        context.iconUrl = context.iconUrl.replace(/resource:\/\/usercontext-content/, "icons");
                    }
                    //console.log("CONTEXTS iconUrl replaced", contexts_or_cookie_stores);

                    // On FF+=57 add containers from contexts
                    stores = stores.concat(contexts_or_cookie_stores);
                }
            } else {
                stores = contexts_or_cookie_stores.map((store) => {
                    let isIncognitoStore = store.id === '1' || (vAPI.isIncognitoContext && store.id !== '0');
                    let name = isIncognitoStore ?
                        browser.i18n.getMessage("container_private") :
                        browser.i18n.getMessage("container_default");

                    if (!(store.id === '0' || store.id === '1'))
                        name += ' (' + store.id + ')';

                    return {
                        name: name,
                        icon: isIncognitoStore ? "private-browsing" : "circle",
                        iconUrl: isIncognitoStore ? "icons/private-browsing.svg" : "",
                        color: isIncognitoStore ? "purple" : "black",
                        colorCode: isIncognitoStore ? "#af51f5" : "#555555",
                        cookieStoreId: store.id,
                    };
                });

                if (!allowed_incognito_access)
                    stores = stores.filter((store) => store.cookieStoreId === '0');

                if (!stores.length)
                    stores = vAPI.storesAllowed;
            }

            // Get only storeIds
            // TODO make a function to acess to this private attribute
            vAPI.storeIds = stores.map(function(store){
                return store.cookieStoreId;
            });
            //console.log({Stores: stores});

    return stores;
}

vAPI.FPI_detection = async function(promise) {
    // Set the attribute vAPI.FPI with the status of First Party Isolation
    // This promise is made to be chained before all promises that call
    // browser.cookies.* on browser that can support or not this new API.
    // vAPI.FPI is undefined if FPI is not supported by the browser,
    // or false/true if supported but disabled/enabled.

    if (!vAPI.supportsFirstPartyIsolation) {
        vAPI.FPI = undefined;
        return promise;
    }

    try {
        const got = await browser.privacy.websites.firstPartyIsolate.get({});
        vAPI.FPI = got.value;
    } catch (error) {
        vAPI.FPI = undefined;
    }
    return promise;
}

vAPI.delete_cookies = async function(promise) {
    // Delete all cookies in the promise
    // Return a promise
    // PS: there is no verification of the support of FPI here
    // because, the promise is already composed of cookies that
    // come from getAll() and have the firstPartyDomain property if it is activated.
    // This presence of this property gives the status of the FPI support.
    // The promise returns the number of remaining cookies (not deleted because
    // they are protected against deletion)
    // NOTE: This function does not try to delete protected cookie

    const [items, cookies] = await Promise.all([
        browser.storage.local.get(null),
        Promise.resolve(promise),
    ]);
    const protectedCookies = core.protectedCookiesFromStorage(items);
    const deletableCookies = cookies.filter((cookie) => !core.isCookieProtected(cookie, protectedCookies));
    const results = await Promise.allSettled(deletableCookies.map((cookie) => vAPI.remove_cookie(cookie)));
    const failures = results.filter((result) => result.status === 'rejected' || result.value === null);
    if (failures.length)
        throw new Error(`${failures.length} cookie(s) could not be removed.`);
    return cookies.length - deletableCookies.length;
}

vAPI.copy_cookies_to_store = async function(promise, store_id) {
    // Copy a set of cookies to the store with the given store_id
    // Return a promise

    const cookies = await Promise.resolve(promise);
    const setPromises = cookies
        .filter((cookie) => cookie.session || cookie.expirationDate > ((Date.now() / 1000 | 0) + 1))
        .map((cookie) => vAPI.set_cookie(core.buildCookieSetDetails({...cookie, storeId: store_id})));
    return vAPI.add_cookies(Promise.all(setPromises));
}

vAPI.add_cookies = async function(new_cookies_promises, protection_status) {
    // Add given cookies to the cookie store
    // Used in export.js and api.js
    // Take a promise on new_cookies_promises
    // Return a promise

    const cookies = await Promise.resolve(new_cookies_promises);
    if (cookies.some((cookie) => cookie === null))
        throw new Error('At least one cookie could not be saved.');
    if (protection_status)
        await vAPI.set_cookie_protection(cookies, true);
    return cookies;
}

vAPI.getCookiesFromSelectedDomain = async function() {
    // Return a Promise with cookies that belong to the selected domain;
    // Return also cookies for subdomains if the subdomain checkbox is checked.
    // https://developer.mozilla.org/fr/docs/Web/JavaScript/Reference/Objets_globaux/Promise
    // TODO: handle multiple domains
    // TODO: pas d'accès à l'interface ici...
    // => la fonction doit prendre directement la liste des domaines, les stores, l'état de query-subdomains
    // Used by export.js on #clipboard_domain_export click event

    const domainObject = document.querySelector('#domain-list li.active');
    if (!domainObject)
        throw new Error('SelectedDomain-NoDomain');
    const domainQuery = $(domainObject).data('domainQuery');
    if (!domainQuery)
        throw new Error('SelectedDomain-NoQuery');
    var domain = domainQuery.id;
    var storeIds = domainQuery.storeIds;
    // TODO: simulate multiple domains
    var domains = [domain, ];
    let promises = [];
    for (let domain of domains) {
        for (let storeId of storeIds) {
            let details = {domain: domain, storeId: storeId};
            if (vAPI.supportsFirstPartyIsolation)
                details.firstPartyDomain = null;

            promises.push(vAPI.get_cookies(details));
        }
    }
    const cookies_array = await Promise.all(promises);
    // Merge all results of promises
    let cookies = Array.prototype.concat(...cookies_array);

    if (cookies.length > 0) {
        let filtered_cookies = [];
        let query_subdomains = $('#query-subdomains').is(':checked');
        if (query_subdomains) {
            filtered_cookies = cookies;
        } else {
            // Sub domains are not wanted here
            for (let cookie of cookies) {
                if (domains.indexOf(cookie.domain) !== -1)
                    filtered_cookies.push(cookie);
            }
        }
        return filtered_cookies;
    } else {
        throw new Error('SelectedDomain-NoCookies');
    }
}

vAPI.commit_cookie_protection = function(cookies, protect_flag) {
    // Iterate on all new cookies and add their domains and names to the
    // array of protected_cookies in local storage.
    // protect_flag: false: unprotect the cookies; true: protect the cookies
    // TODO: make a global promise shared with cookies.js (#protect_button.click) to check
    // the presence of a domain in protected_cookies

    const operation = vAPI.protectionUpdateQueue.then(async () => {
        const items = await browser.storage.local.get(null);
        if (protect_flag) {
            const additions = {};
            for (const cookie of cookies) {
                const record = core.makeProtectionRecord(cookie);
                additions[core.protectionStorageKey(cookie)] = {domain: cookie.domain, record};
            }
            if (Object.keys(additions).length)
                await browser.storage.local.set(additions);
        } else {
            const keys = new Set(cookies.map((cookie) => core.protectionStorageKey(cookie)));
            for (const [key, value] of Object.entries(items)) {
                if (!core.isProtectionStorageKey(key) || !value || typeof value !== 'object')
                    continue;
                for (const cookie of cookies) {
                    if (value.domain === cookie.domain &&
                        core.protectionRecordMatches(value.record, cookie))
                        keys.add(key);
                }
            }
            if (keys.size)
                await browser.storage.local.remove([...keys]);

            // Legacy domain -> [name] rules are retained for compatibility and
            // removed only when the user explicitly unprotects a matching cookie.
            const legacy = core.normalizeProtectedCookies(items.protected_cookies);
            const updatedLegacy = core.updateProtectionMap(legacy, cookies, false);
            if (JSON.stringify(updatedLegacy) !== JSON.stringify(legacy))
                await browser.storage.local.set({protected_cookies: updatedLegacy});
        }
        return vAPI.get_protected_cookies();
    });
    vAPI.protectionUpdateQueue = operation.catch(() => {});
    return operation;
}

vAPI.set_cookie_protection = async function(cookies, protect_flag) {
    const safeCookies = cookies.map((cookie) => ({
        domain: String(cookie.domain ?? ''),
        name: String(cookie.name ?? ''),
        path: core.normalizePath(cookie.path),
        storeId: String(cookie.storeId ?? ''),
        hostOnly: core.parseBoolean(cookie.hostOnly, !String(cookie.domain ?? '').startsWith('.')),
        ...(typeof cookie.firstPartyDomain === 'string' ? {firstPartyDomain: cookie.firstPartyDomain} : {}),
        ...(core.clonePartitionKey(cookie.partitionKey) ? {partitionKey: core.clonePartitionKey(cookie.partitionKey)} : {}),
    }));
    const response = await browser.runtime.sendMessage({
        type: 'cqm:update-protection',
        cookies: safeCookies,
        protect: protect_flag === true,
    });
    if (!response?.ok)
        throw new Error(response?.error || 'Protection update failed.');
    return core.normalizeProtectedCookies(response.protectedCookies);
}

vAPI.get_protected_cookies = async function(storage_items) {
    const items = storage_items || await browser.storage.local.get(null);
    return core.protectedCookiesFromStorage(items);
}

vAPI.setFirstPartyIsolateStatus = function(status) {
    // Set firstPartyIsolate status

    if (!vAPI.supportsFirstPartyIsolation) {
        console.log("First-Party Isolation is not supported by this browser");
        return;
    }

    var getting = browser.privacy.websites.firstPartyIsolate.get({});
    getting.then((got) => {
        //console.log({'got': got});

        if ((got.levelOfControl === "controlled_by_this_extension") ||
            (got.levelOfControl === "controllable_by_this_extension")) {

            // Set the status
            var setting = browser.privacy.websites.firstPartyIsolate.set({
                value: status
            });
            setting.then(vAPI.onSet);

        } else {
            console.log("Not able to set firstPartyIsolate");
        }
    });
}

vAPI.get_and_patch_protected_cookies = function(storage_items) {
    // Wrapper used to patch the storage data key 'protected_cookies'
    // Return the associative array of protected_cookies.
    // Return an empty associative array if something happened

    const protectedCookies = core.normalizeProtectedCookies(storage_items.protected_cookies);
    if (JSON.stringify(protectedCookies) !== JSON.stringify(storage_items.protected_cookies))
        browser.storage.local.set({protected_cookies: protectedCookies}).catch(vAPI.onError);
    return protectedCookies;
}

vAPI.is_cookie_protected = function(cookie, protected_cookies) {
    return core.isCookieProtected(cookie, protected_cookies);
}

vAPI.get_session_cookies = function(cookies) {
    // Return only session cookies from an array of cookies

    let session_cookies = [];
    for (let cookie of cookies) {
        if (cookie.session)
            session_cookies.push(cookie);
    }
    console.log("get_session_cookies:", session_cookies.length);
    return session_cookies;
}

vAPI.ask_permission = function(permission_name) {
    // Ask the given permission to the browser
    // PS: Due to restrictions, this function must be called from a user input handler
    return browser.permissions.request({permissions: [permission_name]})
    .then((response) => {
        console.log("ask_permission:", permission_name, response);
    })
    .catch(err => console.error(err));
}

vAPI.remove_permission = function(permission_name) {
    // Remove a permission
    return browser.permissions.remove({permissions: [permission_name]})
    .catch(err => console.error(err));
}

/*********** Global variables ***********/

// vAPI.default_stores without firefox-private if the extension is not allowed to access private windows
// This attribute is "public" and should be used instead of vAPI.default_stores
vAPI.storesAllowed = [];
vAPI.storeIds = []; //Ex: ['firefox-default', 'firefox-private', ...];
vAPI.protectionUpdateQueue = Promise.resolve();

vAPI.template_JSON = {
    name: 'JSON',
    template: '{\n\
\t"Host raw": "{HOST_RAW}",\n\
\t"Name raw": "{NAME_RAW}",\n\
\t"Path raw": "{PATH_RAW}",\n\
\t"Content raw": "{CONTENT_RAW}",\n\
\t"Expires": "{EXPIRES}",\n\
\t"Expires raw": "{EXPIRES_RAW}",\n\
\t"Send for": "{ISSECURE}",\n\
\t"Send for raw": "{ISSECURE_RAW}",\n\
\t"HTTP only raw": "{ISHTTPONLY_RAW}",\n\
\t"SameSite raw": "{SAMESITE_RAW}",\n\
\t"This domain only": "{ISDOMAIN}",\n\
\t"This domain only raw": "{ISDOMAIN_RAW}",\n\
\t"Store raw": "{STORE_RAW}",\n\
\t"First Party Domain": "{FPI_RAW}"\n\
}',
    left_tag: '[',
    right_tag: ']',
    separator: ',\n',
};

vAPI.template_Netscape = {
    name: 'NETSCAPE',
    template: '{DOMAIN_RAW}\t{ISDOMAIN_RAW}\t{PATH_RAW}\t{ISSECURE_RAW}\t{EXPIRES_RAW}\t{NAME_RAW}\t{CONTENT_RAW}',
    left_tag: '',
    right_tag: '',
    separator: '\n',
};

vAPI.templates = {
    JSON: vAPI.template_JSON,
    NETSCAPE: vAPI.template_Netscape,
};

// Global date format
// PS: "DD-MM-YYYY hh:mm:ss a"), 'a' is for am/pm
vAPI.date_format = "DD-MM-YYYY HH:mm:ss";

// Optimal size of the windowed addon
vAPI.optimal_window_width = 1095;
vAPI.optimal_window_height = 640;

vAPI.query_domain = "";
vAPI.query_names = [];
vAPI.query_values = [];

})(globalThis);
