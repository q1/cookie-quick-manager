/*
 * Cookie Quick Manager: browser-independent cookie and settings helpers.
 *
 * Keep this file free of DOM and WebExtension API calls. It is loaded by the
 * extension pages and service worker, and directly by the Node test suite.
 */
'use strict';

(function(root, factory) {
    const core = factory();

    if (typeof module === 'object' && module.exports)
        module.exports = core;

    root.CQMCore = core;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
    const SAME_SITE_VALUES = new Set(['no_restriction', 'lax', 'strict', 'unspecified']);
    const PROTECTION_STORAGE_PREFIX = 'protected_cookie:';
    const BOOLEAN_SETTINGS = [
        'auto_actualize_checkbox',
        'delete_all_on_restart',
        'display_deletion_alert',
        'import_protected_cookies',
        'open_in_new_tab',
        'prevent_protected_cookies_deletion',
    ];
    const DEFAULT_SETTINGS = Object.freeze({
        auto_actualize_checkbox: false,
        delete_all_on_restart: false,
        display_deletion_alert: true,
        import_protected_cookies: false,
        open_in_new_tab: true,
        prevent_protected_cookies_deletion: true,
        protected_cookies: Object.freeze({}),
        skin: 'default',
        template: 'JSON',
    });

    function hasOwn(value, key) {
        return Object.prototype.hasOwnProperty.call(value, key);
    }

    function getDefaultSettings() {
        return {...DEFAULT_SETTINGS, protected_cookies: {}};
    }

    function normalizeDomain(domain) {
        const normalized = String(domain ?? '').trim().replace(/^\.+/, '');
        if (!normalized || /[\s\\/?#@]/.test(normalized))
            throw new TypeError('Cookie domain is invalid.');
        try {
            const hostname = new URL(`http://${formatHostname(normalized)}/`).hostname;
            return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
        } catch (error) {
            throw new TypeError('Cookie domain is invalid.');
        }
    }

    function normalizePath(path) {
        const normalized = String(path || '/');
        return normalized.startsWith('/') ? normalized : `/${normalized}`;
    }

    function canonicalizeSetPath(path) {
        const normalized = normalizePath(path);
        return new URL(`http://cookie.invalid${normalized.replace(/\?/g, '%3F').replace(/#/g, '%23')}`).pathname;
    }

    function formatHostname(domain) {
        if (domain.includes(':') && !(domain.startsWith('[') && domain.endsWith(']')))
            return `[${domain}]`;
        return domain;
    }

    function getCookieUrl(cookie) {
        const domain = normalizeDomain(cookie.domain);
        const protocol = cookie.secure ? 'https:' : 'http:';
        const safePath = normalizePath(cookie.path).replace(/\?/g, '%3F').replace(/#/g, '%23');
        return `${protocol}//${formatHostname(domain)}${safePath}`;
    }

    function getCookieOriginUrl(cookie) {
        const domain = normalizeDomain(cookie.domain);
        const protocol = cookie.secure ? 'https:' : 'http:';
        return `${protocol}//${formatHostname(domain)}/`;
    }

    function normalizeHttpUrl(rawUrl) {
        if (typeof rawUrl !== 'string')
            throw new TypeError('Cookie URL is missing.');

        // Cookie Quick Manager versions before 0.6 exported domain-cookie URLs
        // such as "https://.example.com/". Repair those dumps on import.
        const repairedUrl = rawUrl.trim().replace(/^(https?:\/\/)\./i, '$1');
        const parsedUrl = new URL(repairedUrl);
        if (!['http:', 'https:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password)
            throw new TypeError('Cookie URL must use HTTP or HTTPS.');
        return parsedUrl.toString();
    }

    function parseBoolean(value, fallback = false) {
        const normalized = typeof value === 'string' ? value.trim().toLowerCase() : value;
        if (normalized === true || normalized === 'true' || normalized === 1 || normalized === '1')
            return true;
        if (normalized === false || normalized === 'false' || normalized === 0 || normalized === '0')
            return false;
        return fallback;
    }

    function clonePartitionKey(partitionKey) {
        if (!partitionKey || typeof partitionKey !== 'object')
            return undefined;

        const cloned = {};
        if (typeof partitionKey.topLevelSite === 'string' && partitionKey.topLevelSite)
            cloned.topLevelSite = partitionKey.topLevelSite;
        if (typeof partitionKey.hasCrossSiteAncestor === 'boolean')
            cloned.hasCrossSiteAncestor = partitionKey.hasCrossSiteAncestor;
        return Object.keys(cloned).length ? cloned : undefined;
    }

    function addCookieScope(details, cookie) {
        if (typeof cookie.storeId === 'string' && cookie.storeId)
            details.storeId = cookie.storeId;
        if (hasOwn(cookie, 'firstPartyDomain') && typeof cookie.firstPartyDomain === 'string')
            details.firstPartyDomain = cookie.firstPartyDomain;

        const partitionKey = clonePartitionKey(cookie.partitionKey);
        if (partitionKey)
            details.partitionKey = partitionKey;
        return details;
    }

    function buildCookieQueryDetails(cookie) {
        return addCookieScope({
            domain: formatHostname(normalizeDomain(cookie.domain)),
            name: String(cookie.name ?? ''),
            path: normalizePath(cookie.path),
        }, cookie);
    }

    function buildCookieDeletionDetails(cookie) {
        const rawDomain = String(cookie.domain ?? '').trim();
        const hostOnly = hasOwn(cookie, 'hostOnly') ?
            parseBoolean(cookie.hostOnly, true) : !rawDomain.startsWith('.');
        const details = addCookieScope({
            url: getCookieOriginUrl(cookie),
            name: String(cookie.name ?? ''),
            // A nameless cookie is serialized as its value without '='. An
            // empty-name/empty-value tombstone is ignored by Chromium, so
            // retain the value while expiring that exact identity.
            value: String(cookie.name ?? '') === '' ? String(cookie.value ?? '') : '',
            path: normalizePath(cookie.path),
            secure: parseBoolean(cookie.secure),
            expirationDate: 1,
        }, cookie);
        if (!hostOnly)
            details.domain = normalizeDomain(rawDomain);
        return details;
    }

    function buildCookieSetDetails(cookie, options = {}) {
        const now = Number.isFinite(options.now) ? options.now : Date.now() / 1000;
        const rawDomain = String(cookie.domain ?? '').trim();
        const secure = parseBoolean(cookie.secure);
        const details = addCookieScope({
            url: getCookieUrl({...cookie, secure}),
            name: String(cookie.name ?? ''),
            value: String(cookie.value ?? ''),
            path: normalizePath(cookie.path),
            httpOnly: parseBoolean(cookie.httpOnly),
            secure,
        }, cookie);

        const hostOnly = hasOwn(cookie, 'hostOnly') ? parseBoolean(cookie.hostOnly, true) : !rawDomain.startsWith('.');
        if (!hostOnly)
            details.domain = normalizeDomain(rawDomain);

        if (SAME_SITE_VALUES.has(cookie.sameSite) && cookie.sameSite !== 'unspecified') {
            // Chromium rejects SameSite=None cookies which are not Secure.
            if (!(cookie.sameSite === 'no_restriction' && !secure))
                details.sameSite = cookie.sameSite;
        }

        const expirationDate = Number(cookie.expirationDate);
        const isSession = hasOwn(cookie, 'session') ? parseBoolean(cookie.session) : !Number.isFinite(expirationDate);
        if (!isSession) {
            if (!Number.isFinite(expirationDate) || expirationDate <= now + 1)
                throw new RangeError('Persistent cookie expiration must be in the future.');
            details.expirationDate = expirationDate;
        }

        return details;
    }

    function cookieScopeFromSetDetails(details) {
        if (!details || typeof details !== 'object')
            throw new TypeError('Cookie set details are missing.');
        const parsedUrl = new URL(normalizeHttpUrl(details.url));
        const hasDomain = typeof details.domain === 'string' && details.domain.trim() !== '';
        const cookie = {
            domain: hasDomain ? `.${normalizeDomain(details.domain)}` : parsedUrl.hostname,
            hostOnly: !hasDomain,
            path: canonicalizeSetPath(details.path || parsedUrl.pathname),
            name: String(details.name ?? ''),
            storeId: String(details.storeId ?? ''),
            secure: parseBoolean(details.secure, parsedUrl.protocol === 'https:'),
        };
        if (hasOwn(details, 'firstPartyDomain') && typeof details.firstPartyDomain === 'string')
            cookie.firstPartyDomain = details.firstPartyDomain;
        const partitionKey = clonePartitionKey(details.partitionKey);
        if (partitionKey)
            cookie.partitionKey = partitionKey;
        return cookie;
    }

    function stablePartitionKey(partitionKey) {
        const cloned = clonePartitionKey(partitionKey);
        if (!cloned)
            return '';
        return `${cloned.topLevelSite || ''}|${cloned.hasCrossSiteAncestor === true ? '1' : '0'}`;
    }

    function cookieIdentity(cookie) {
        return JSON.stringify([
            String(cookie.domain ?? ''),
            normalizePath(cookie.path),
            String(cookie.name ?? ''),
            String(cookie.storeId ?? ''),
            String(cookie.firstPartyDomain ?? ''),
            stablePartitionKey(cookie.partitionKey),
            parseBoolean(cookie.hostOnly, !String(cookie.domain ?? '').startsWith('.')),
        ]);
    }

    function makeProtectionRecord(cookie) {
        const record = {
            name: String(cookie.name ?? ''),
            path: normalizePath(cookie.path),
            storeId: String(cookie.storeId ?? ''),
            hostOnly: parseBoolean(cookie.hostOnly, !String(cookie.domain ?? '').startsWith('.')),
        };
        if (hasOwn(cookie, 'firstPartyDomain') && typeof cookie.firstPartyDomain === 'string')
            record.firstPartyDomain = cookie.firstPartyDomain;
        const partitionKey = clonePartitionKey(cookie.partitionKey);
        if (partitionKey)
            record.partitionKey = partitionKey;
        return record;
    }

    function protectionStorageKey(cookie) {
        return `${PROTECTION_STORAGE_PREFIX}${cookieIdentity(cookie)}`;
    }

    function isProtectionStorageKey(key) {
        return typeof key === 'string' && key.startsWith(PROTECTION_STORAGE_PREFIX);
    }

    function protectedCookiesFromStorage(storageItems) {
        const protectedCookies = normalizeProtectedCookies(storageItems?.protected_cookies);
        if (!storageItems || typeof storageItems !== 'object')
            return protectedCookies;

        for (const [key, value] of Object.entries(storageItems)) {
            if (!isProtectionStorageKey(key) || !value || typeof value !== 'object')
                continue;
            const domain = String(value.domain ?? '');
            if (!domain || !isProtectionRecord(value.record))
                continue;
            const cookie = {...value.record, domain};
            if (key !== protectionStorageKey(cookie))
                continue;
            const records = protectedCookies[domain] || [];
            if (!records.some((record) => protectionRecordMatches(record, cookie)))
                records.push(makeProtectionRecord(cookie));
            protectedCookies[domain] = records;
        }
        return protectedCookies;
    }

    function isProtectionRecord(value) {
        return Boolean(value && typeof value === 'object' && !Array.isArray(value) &&
            typeof value.name === 'string' && typeof value.path === 'string' &&
            typeof value.storeId === 'string');
    }

    function protectionRecordMatches(record, cookie) {
        if (typeof record === 'string')
            return record === cookie.name;
        if (!isProtectionRecord(record))
            return false;
        const comparableRecord = {...record, domain: cookie.domain};
        const recordPartition = clonePartitionKey(record.partitionKey);
        const cookiePartition = clonePartitionKey(cookie.partitionKey);
        if (recordPartition && cookiePartition &&
            recordPartition.topLevelSite === cookiePartition.topLevelSite &&
            typeof recordPartition.hasCrossSiteAncestor !== 'boolean') {
            // Older Chrome and Firefox protection records did not expose this
            // bit. Treat the missing bit as a wildcard during migration.
            comparableRecord.partitionKey = {...recordPartition};
            if (typeof cookiePartition.hasCrossSiteAncestor === 'boolean')
                comparableRecord.partitionKey.hasCrossSiteAncestor = cookiePartition.hasCrossSiteAncestor;
        }
        return cookieIdentity(comparableRecord) === cookieIdentity(cookie);
    }

    function normalizeProtectedCookies(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value))
            return Object.create(null);

        const normalized = Object.create(null);
        for (const [domain, records] of Object.entries(value)) {
            if (!Array.isArray(records))
                continue;
            const cleanRecords = [];
            for (const record of records) {
                if (typeof record === 'string' && record) {
                    if (!cleanRecords.includes(record))
                        cleanRecords.push(record);
                } else if (isProtectionRecord(record)) {
                    const cleanRecord = {
                        name: record.name,
                        path: normalizePath(record.path),
                        storeId: record.storeId,
                        hostOnly: parseBoolean(record.hostOnly, !domain.startsWith('.')),
                    };
                    if (typeof record.firstPartyDomain === 'string')
                        cleanRecord.firstPartyDomain = record.firstPartyDomain;
                    const partitionKey = clonePartitionKey(record.partitionKey);
                    if (partitionKey)
                        cleanRecord.partitionKey = partitionKey;
                    if (!cleanRecords.some((candidate) => isProtectionRecord(candidate) &&
                        protectionRecordMatches(candidate, {...cleanRecord, domain})))
                        cleanRecords.push(cleanRecord);
                }
            }
            if (cleanRecords.length)
                normalized[domain] = cleanRecords;
        }
        return normalized;
    }

    function isCookieProtected(cookie, protectedCookies) {
        const records = protectedCookies && protectedCookies[cookie.domain];
        return Array.isArray(records) && records.some((record) => protectionRecordMatches(record, cookie));
    }

    function updateProtectionMap(protectedCookies, cookies, protect) {
        const updated = normalizeProtectedCookies(protectedCookies);
        for (const cookie of cookies) {
            const domain = String(cookie.domain ?? '');
            if (!domain || typeof cookie.name !== 'string')
                continue;
            const records = updated[domain] || [];
            if (protect) {
                if (!records.some((record) => protectionRecordMatches(record, cookie)))
                    records.push(makeProtectionRecord(cookie));
                updated[domain] = records;
            } else {
                const remaining = records.filter((record) => !protectionRecordMatches(record, cookie));
                if (remaining.length)
                    updated[domain] = remaining;
                else
                    delete updated[domain];
            }
        }
        return updated;
    }

    function parseSearchQuery(searchQuery) {
        const source = String(searchQuery ?? '');
        const names = [];
        const values = [];
        const ranges = [];
        const tokenPattern = /:(name|value):"((?:\\.|[^"\\])*)"/g;
        let match;
        while ((match = tokenPattern.exec(source)) !== null) {
            const term = match[2].replace(/\\([\\"])/g, '$1');
            if (term)
                (match[1] === 'name' ? names : values).push(term);
            ranges.push([match.index, tokenPattern.lastIndex]);
        }

        let residual = '';
        let cursor = 0;
        for (const [start, end] of ranges) {
            residual += source.slice(cursor, start) + ' ';
            cursor = end;
        }
        residual += source.slice(cursor);
        const domains = residual.trim().split(/\s+/).filter(Boolean);
        return {domain: domains[0] || '', names, values};
    }

    function filterCookies(cookies, query) {
        const domain = String(query?.domain ?? '');
        const hostname = String(query?.hostname ?? '').toLowerCase().replace(/^\.+|\.+$/g, '');
        const names = Array.isArray(query?.names) ? query.names : [];
        const values = Array.isArray(query?.values) ? query.values : [];
        return cookies.filter((cookie) => {
            const cookieDomain = String(cookie.domain ?? '').toLowerCase().replace(/^\.+|\.+$/g, '');
            if (hostname) {
                const hostOnly = parseBoolean(cookie.hostOnly, !String(cookie.domain ?? '').startsWith('.'));
                if (hostOnly ? hostname !== cookieDomain :
                    !(hostname === cookieDomain || hostname.endsWith(`.${cookieDomain}`)))
                    return false;
            }
            if (!hostname && domain && !String(cookie.domain).includes(domain))
                return false;
            const nameMatches = !names.length || names.some((name) => String(cookie.name).includes(name));
            const valueMatches = !values.length || values.some((value) => String(cookie.value).includes(value));
            return nameMatches && valueMatches;
        });
    }

    function parseJsonCookieRecord(record, options = {}) {
        if (!record || typeof record !== 'object' || Array.isArray(record))
            throw new TypeError('Cookie entry must be an object.');

        const url = normalizeHttpUrl(record['Host raw']);
        const parsedUrl = new URL(url);
        const hostOnly = parseBoolean(record['This domain only raw'], true);
        const cookie = {
            domain: hostOnly ? parsedUrl.hostname : `.${parsedUrl.hostname}`,
            hostOnly,
            url,
            name: String(record['Name raw'] ?? ''),
            value: String(record['Content raw'] ?? ''),
            path: String(record['Path raw'] || parsedUrl.pathname || '/'),
            httpOnly: parseBoolean(record['HTTP only raw']),
            secure: parseBoolean(record['Send for raw'], parsedUrl.protocol === 'https:'),
            session: String(record['Expires raw'] ?? '0') === '0',
        };

        const expirationDate = Number.parseInt(record['Expires raw'], 10);
        if (!cookie.session) {
            if (!Number.isFinite(expirationDate))
                throw new TypeError(`Invalid expiration date for cookie "${cookie.name}".`);
            cookie.expirationDate = expirationDate;
        }

        if (SAME_SITE_VALUES.has(record['SameSite raw']))
            cookie.sameSite = record['SameSite raw'];
        const storeId = record['Store raw'] ?? options.defaultStoreId;
        if (storeId !== undefined && storeId !== null && String(storeId))
            cookie.storeId = String(storeId);
        if (options.supportsFirstPartyIsolation)
            cookie.firstPartyDomain = typeof record['First Party Domain'] === 'string' ?
                record['First Party Domain'] : '';
        if (record['Partition key'] && typeof record['Partition key'] === 'object')
            cookie.partitionKey = record['Partition key'];

        return buildCookieSetDetails(cookie, options);
    }

    function sanitizeSettings(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value))
            throw new TypeError('Settings backup must contain a JSON object.');

        const clean = {};
        for (const key of BOOLEAN_SETTINGS) {
            if (typeof value[key] === 'boolean')
                clean[key] = value[key];
        }
        if (['default', 'hacker_style'].includes(value.skin))
            clean.skin = value.skin;
        if (['JSON', 'NETSCAPE'].includes(value.template))
            clean.template = value.template;
        if (hasOwn(value, 'protected_cookies'))
            clean.protected_cookies = normalizeProtectedCookies(value.protected_cookies);
        for (const [key, storedProtection] of Object.entries(value)) {
            if (!isProtectionStorageKey(key) || !storedProtection || typeof storedProtection !== 'object')
                continue;
            const domain = String(storedProtection.domain ?? '');
            if (domain && isProtectionRecord(storedProtection.record)) {
                const cookie = {...storedProtection.record, domain};
                clean[protectionStorageKey(cookie)] = {domain, record: makeProtectionRecord(cookie)};
            }
        }
        if (value.addonSize && typeof value.addonSize === 'object') {
            const width = Number(value.addonSize.width);
            const height = Number(value.addonSize.height);
            if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)
                clean.addonSize = {width, height};
        }
        return clean;
    }

    return Object.freeze({
        buildCookieQueryDetails,
        buildCookieDeletionDetails,
        buildCookieSetDetails,
        clonePartitionKey,
        canonicalizeSetPath,
        cookieIdentity,
        cookieScopeFromSetDetails,
        filterCookies,
        getDefaultSettings,
        getCookieUrl,
        getCookieOriginUrl,
        isCookieProtected,
        isProtectionStorageKey,
        makeProtectionRecord,
        normalizeDomain,
        normalizeHttpUrl,
        normalizePath,
        normalizeProtectedCookies,
        parseBoolean,
        parseJsonCookieRecord,
        parseSearchQuery,
        protectedCookiesFromStorage,
        protectionStorageKey,
        protectionRecordMatches,
        sanitizeSettings,
        updateProtectionMap,
    });
});
