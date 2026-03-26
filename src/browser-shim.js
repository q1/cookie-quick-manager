/*
 *  Cookie Quick Manager: lightweight browser namespace shim for Chromium.
 */
'use strict';

if (typeof globalThis.browser === 'undefined' && typeof globalThis.chrome !== 'undefined') {
    globalThis.browser = globalThis.chrome;
}
