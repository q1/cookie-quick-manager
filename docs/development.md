# Development

## Requirements

- Node.js 24 and npm (the repository includes a single npm lockfile).
- A current Chromium-based browser and Firefox for real extension checks.
- Playwright's Chromium and Firefox runtimes for the automated browser suite.

```sh
npm ci
npm run dev
```

Open the URL printed by Vite (normally `http://localhost:5173`). The demo uses
synthetic cookies through a local adapter. It does not inspect your real browser
cookie jar. Use it for interface work and tests without personal session data.

## Run the extension

```sh
npm run dev:chrome
npm run dev:firefox
```

These use WXT's browser-specific development builds. Follow the terminal
output; if a browser cannot be launched automatically, load its generated
manifest manually. Development manifests may contain tooling permissions or
connections that are absent from production builds. Inspect the production
manifest when reviewing release permissions.

## Build and load production artifacts

```sh
npm run build
```

Chromium: open `chrome://extensions`, enable **Developer mode**, choose **Load
unpacked**, and select `apps/extension/.output/chrome-mv3`.

Firefox: open `about:debugging#/runtime/this-firefox`, choose **Load Temporary
Add-on**, and select `apps/extension/.output/firefox-mv3/manifest.json`.
Temporary installations are removed on restart. These local builds are not
store-signed packages. See [Mozilla's temporary-installation guide](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/).

## Checks

```sh
npm run format:check
npm audit --omit=dev
npm run check
npm test
npm run build
npm run lint:firefox
npx playwright install chromium firefox
npm run test:e2e
npm run test:firefox
npm run zip
npm run verify:builds
```

On Linux CI, Playwright may also require system libraries; install its browser
dependencies for that environment. The unit suite should exercise shared rules
and browser-boundary behavior. Browser tests cover the demo and any packaged
extension scenarios described in the test files. Always distinguish a demo
test from a real-browser extension test in review notes.

The Playwright suite runs the synthetic demo on desktop Chromium and Firefox,
checks a narrow viewport, and loads the built Chromium extension in a disposable
profile. It checks the unchanged extension's no-access state, then uses a copied
artifact with test-only host grants to exercise real browser cookie operations.
The production optional-permission prompt cannot be accepted in headless Chrome
and remains a manual verification item.

`npm run test:firefox` uses a separate disposable Firefox profile and a copied
artifact to exercise the real Firefox APIs, including containers, partitions,
first-party isolation, and background lifecycle behavior. Its manifest also
adds test-only host grants. Neither harness changes the production build.

`npm run lint:firefox` runs the repository's reviewed validation wrapper. It
rejects manifest errors and unexpected warnings. React DOM's two internal
`innerHTML` warnings are accepted only in its isolated vendor chunk, while the
script rejects HTML-injection sinks in application source. This is an explicit
framework exception, not a claim that raw `web-ext lint` produces no warnings.

For manual extension checks, use a fresh browser profile and follow
[the verification checklist](verification.md). Avoid loading test cookies into
a personal or work profile. Tests must not contact real account services.

## Workspace layout

```text
apps/extension/   React surfaces, browser adapter, WXT configuration, demo
packages/core/    Cookie types and browser-independent rules
docs/            Architecture, migration, verification, and releases
legacy/          Original extension and historical store assets
```

Never edit generated `.output` files as the source of a fix. Update the source,
rebuild, and reload the extension. Do not commit `node_modules`, build artifacts,
real cookie exports, personal profiles, or signing credentials.

## Dependency and release changes

Commit the lockfile with dependency updates. Explain why a new runtime
dependency is needed, its license, and whether it changes network or permission
behavior. Build artifacts do not prove supply-chain safety; review dependency
diffs and generated manifests. Packaging and publication steps are described in
[the release guide](releasing.md).

Run `npm run format:check` for formatting and `npm audit --omit=dev` for the
production dependency audit. The current development-only advisory and its
scope are recorded in [the dependency review](dependency-review.md).

CI runs these checks on pull requests and pushes. It uploads unsigned browser
archives, corresponding source, and SHA-256 checksums for review. Maintainers
can also run CI manually; it does not publish releases or submit to stores.
