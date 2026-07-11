/* Lightweight browser namespace compatibility for current Chromium builds. */
'use strict';

if (typeof globalThis.browser === 'undefined' && typeof globalThis.chrome !== 'undefined')
    globalThis.browser = globalThis.chrome;
