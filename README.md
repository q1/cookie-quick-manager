# Cookie Quick Manager

Cookie Quick Manager is a privacy-oriented browser extension for viewing, searching, creating, editing, deleting, protecting, exporting, and importing cookies. It also provides a popup action for clearing the active page's LocalStorage.

This fork modernizes the original extension as a shared Manifest V3 codebase with target-specific builds for:

- Chromium 130+
- Firefox desktop 140+
- Firefox for Android 142+

The project remains GPLv3 and retains attribution to the original Cookie Quick Manager project by Ysard.

## What it supports

- Host-only and domain-scoped cookies
- Session and persistent cookies
- Secure, HttpOnly, and SameSite attributes
- Exact path, store, host/domain, First-Party Isolation, and partition identity
- Chromium partitioned cookies (CHIPS), including visible partition scope
- Firefox containers/contextual identities and First-Party Isolation controls
- Search by domain, name, and value, with optional subdomain grouping
- JSON and Netscape `cookies.txt` import/export
- Exact cookie protection and restoration after an explicit site deletion
- Bulk deletion of only the cookies currently visible through the active filters
- Split-incognito Chromium stores when the user enables Allow in Incognito
- Popup counts and exact-origin LocalStorage clearing

Natural cookie expiry and browser eviction are intentionally not reversed. Protection is for explicit deletion, not a way to make expired cookies immortal.

## Browser-specific behavior

Chromium uses an extension service worker and generic cookie stores. Firefox uses background scripts and retains its container and privacy APIs. The Firefox-only First-Party Isolation UI is hidden on Chromium.

The manager opens in a tab by default. Windowed mode uses a normal extension popup window. Chromium users must enable Allow in Incognito before private-store cookies are available to the extension.

## Install and build

The project explicitly uses npm:

```bash
npm ci
npm run build:all
```

Artifacts:

- `build/` — unpacked Chromium extension
- `build-firefox/` — unpacked Firefox extension
- `dist/cookie_quick_manager-chromium.zip` — after `npm run package`
- `dist/cookie_quick_manager-firefox.zip` — after `npm run package:firefox`

For Chromium, open `chrome://extensions`, enable Developer mode, choose Load unpacked, and select `build/`.

For Firefox, load `build-firefox/` temporarily from `about:debugging`, or run:

```bash
npx web-ext run --source-dir=build-firefox --firefox=/usr/bin/firefox --no-input
```

## Test and release checks

Run the complete local gate:

```bash
npm run check
```

This gate:

- runs the browser-independent unit and adapter contracts;
- syntax-checks source, QA, and build scripts;
- builds Chromium and Firefox artifacts;
- lints the Firefox artifact with `web-ext`;
- launches the unpacked Chromium extension in Playwright and runs the full browser regression suite.

The Chromium QA runner generates its ignored development certificate when needed, starts the loopback-only fixture server, maps `lvh.me` locally in Chromium, and stops the fixture process it owns. A separately running fixture is reused.

Focused commands:

```bash
npm run test:unit
npm run qa:chromium
npm test
```

The browser suite covers real manager, options, import/export, protection, and popup paths. Its scenarios include exact host/domain and path collisions, stale-value rotation, site-specific parent-domain filtering, aging backups, nameless cookies, uppercase/BOM Netscape files, partition round-trips and UI disambiguation, settings replacement/reset, hostile markup, and actual popup LocalStorage clearing.

See [qa/PARITY_REPORT.md](qa/PARITY_REPORT.md) for dated evidence and the remaining browser matrix limitations.

### Manual fixture use

The fixture can also be run interactively:

```bash
npm run fixture:cert
npm run fixture:start
```

Entry points:

- `http://lvh.me:4173/`
- `http://sub.lvh.me:4173/`
- `https://lvh.me:4443/`
- `https://sub.lvh.me:4443/`

The server binds to `127.0.0.1` by default.

## Privacy and permissions

The extension does not transmit browsing data or cookie contents. Settings and cookie-protection identity metadata are stored locally. Cookie values are not placed in extension storage.

Permissions are used as follows:

- `cookies` and `<all_urls>` — inspect and modify cookies for sites the user visits
- `activeTab` and `scripting` — count and clear LocalStorage for the exact active origin
- `storage` — settings and protected-cookie identity metadata
- `clipboardWrite` (optional) — copy exported cookies
- `contextualIdentities` and `privacy` (Firefox only) — containers and First-Party Isolation

Protection metadata includes domain, name, path, store, host/domain scope, and partition/FPI scope. Chromium shares `storage.local` between regular and split-incognito extension processes, but the cookie jars remain separate.

Browser-level clear-on-close policies may delete cookies before an extension can preserve them. The add-on's own startup cleanup instead retains protected identities.

## Compatibility notes

- Current JSON exports retain store, FPI, SameSite, host/domain, and partition metadata.
- Older exports containing malformed URLs such as `https://.example.com/` are repaired during import.
- Structurally valid expired persistent records are skipped while the rest of an aging backup is restored.
- Netscape import accepts standard case-insensitive `TRUE`/`FALSE` flags and `#HttpOnly_` entries.
- Firefox uses a fork-specific extension ID and declares no data collection in its manifest.

## Contributing

Issues and pull requests belong at [q1/cookie-quick-manager](https://github.com/q1/cookie-quick-manager). Translation files are under `src/_locales/`.

The historical upstream is [ysard/cookie-quick-manager](https://github.com/ysard/cookie-quick-manager).

## License

[GNU General Public License v3.0](LICENSE)
