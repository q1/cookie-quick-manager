# Development

## Requirements

- [Bun 1.4.3](https://bun.sh/blog/bun-v1.4.3), matching `.bun-version` and
  `packageManager` in `package.json`. Check your installation with `bun --version`.
- A current Chromium-based browser and Firefox for real extension checks.
- Playwright's Chromium and Firefox runtimes for the automated browser suite.

```sh
bun install --frozen-lockfile --ignore-scripts
bun run dev
```

Open the URL printed by Vite (normally `http://localhost:5173`). The demo uses
synthetic cookies through a local adapter. It does not inspect your real browser
cookie jar. Use it for interface work and tests without personal session data.

## Bun toolchain

The maintained development and release commands run under Bun. A separate Node.js
or npm installation is not required. `bun.lock` pins the workspace dependency
graph, and `bunfig.toml` keeps hoisted installation compatible with the extension
tools. The documented install command disables lifecycle scripts; asset generation and WXT
preparation run explicitly through the reviewed project commands.

`bun run typecheck` prepares WXT's generated types and runs native `bun check`
for both packages in parallel. Use the `typecheck` script name: `bun check` is
Bun's built-in checker. TypeScript remains installed for editor and tool library
types; Bun's checker does not emit JavaScript or declaration files.

`bun run test` runs the native Bun unit suite with four parallel workers.
`bun run test:watch` reruns units while you edit. Unit discovery excludes
Playwright, native Firefox fixtures, and archived source; their dedicated
commands remain separate.

The [`run.bun` and `run.noOrphans` settings](https://bun.sh/docs/runtime/bunfig#bun-run)
make packaged JavaScript commands use Bun and terminate descendant processes when
their supervising process exits. Scripts use Bun's compatible `node:*` APIs.
WXT and Vite still compile the browser extension; it executes in the browser's
JavaScript engine. See [measured toolchain results](toolchain-performance.md).

The exact Bun version is checked before builds, ZIP packaging, and typechecking.
Upgrade `.bun-version`, `packageManager`, and the engine pin together.
The pinned web-ext patch makes Firefox startup errors explicit under Bun while
preserving connection retries. It is development tooling, included in the source
ZIP for reproducibility. See [the patch review and removal criteria](dependency-review.md#bun-compatibility-patch).

## Run the extension

```sh
bun run dev:chrome
bun run dev:firefox
```

These use WXT's browser-specific development builds. Follow the terminal
output; if a browser cannot be launched automatically, load its generated
manifest manually. Development manifests may contain tooling permissions or
connections that are absent from production builds. Inspect the production
manifest when reviewing release permissions.

## Build and load production artifacts

```sh
bun run build
```

Chromium: open `chrome://extensions`, enable **Developer mode**, choose **Load
unpacked**, and select `apps/extension/.output/chrome-mv3`.

Firefox: open `about:debugging#/runtime/this-firefox`, choose **Load Temporary
Add-on**, and select `apps/extension/.output/firefox-mv3/manifest.json`.
Temporary installations are removed on restart. These local builds are not
store-signed packages. See [Mozilla's temporary-installation guide](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/).

## Checks

```sh
bun run format:check
bun audit --prod
bun run typecheck
bun run test
bun run build
bun run lint:firefox
bunx --bun playwright install chromium firefox
bun run test:e2e
bun run test:firefox
bun run zip
bun run verify:builds
bun run verify:sources
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

`bun run test:firefox` uses a separate disposable Firefox profile and a copied
artifact to exercise the real Firefox APIs, including containers, partitions,
first-party isolation, and background lifecycle behavior. Its manifest also
adds test-only host grants. Neither harness changes the production build.

`bun run lint:firefox` runs the repository's reviewed validation wrapper. It
rejects manifest errors and unexpected warnings. Preact's one internal
`innerHTML` warnings are accepted only in its isolated vendor chunk, while the
script rejects HTML-injection sinks in application source. This is an explicit
framework exception, not a claim that raw `web-ext lint` produces no warnings.

For manual extension checks, use a fresh browser profile and follow
[the verification checklist](verification.md). Avoid loading test cookies into
a personal or work profile. Tests must not contact real account services.

`bun run benchmark:extension -- --output /tmp/loom-performance.json` measures
the compiled Chromium extension with 2,000 synthetic native cookies, a disposable
profile, one warmup, seven measured samples, and 4× CPU throttling on UI pages.
The copied manifest has upfront test-only host grants; product code is unchanged.
Close competing browser/build jobs first. Use `--build /path/to/build` to compare
an older artifact. This benchmark is a diagnostic, not a timing gate in CI.
See [the methodology and raw samples](extension-performance.md).

`verify:builds` enforces explicit raw installed-size, total JavaScript, popup,
and workbench startup budgets. Update a budget only with a measured, reviewed
reason. Dynamic feature chunks count toward total JavaScript but not startup.

## Workspace layout

```text
apps/extension/   Preact surfaces, browser adapter, WXT configuration, demo
packages/core/    Cookie types and browser-independent rules
docs/            Architecture, migration, verification, and releases
legacy/          Original extension and historical store assets
```

Never edit generated `.output` files as the source of a fix. Update the source,
rebuild, and reload the extension. Do not commit `node_modules`, build artifacts,
real cookie exports, personal profiles, or signing credentials.

## Dependency and release changes

Commit `bun.lock` with dependency updates. Explain why a new runtime
dependency is needed, its license, and whether it changes network or permission
behavior. Build artifacts do not prove supply-chain safety; review dependency
diffs and generated manifests. Packaging and publication steps are described in
[the release guide](releasing.md).

Run `bun run format:check` for formatting and `bun audit --prod` for the
production dependency audit. The current development-only advisory and its
scope are recorded in [the dependency review](dependency-review.md).

CI runs these checks on pull requests and pushes. It uploads unsigned browser
archives, corresponding source, and SHA-256 checksums for review. Maintainers
can also run CI manually. The separate annotated-tag workflow publishes GitHub
previews after verification; browser signing and store submission require
publisher accounts. See [the release guide](releasing.md).
