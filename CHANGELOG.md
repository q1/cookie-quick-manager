# Changelog

Notable user-facing changes are recorded here. Cookie Loom versions are
independent of the historical Cookie Quick Manager version numbers.

## 0.1.2-preview.1 — 2026-10-12

### Changed

- Selected backup files are read in a disposable worker and no longer expanded
  into the textarea. Large pasted imports also use a worker; small pastes retain
  the inline path. Preview processing shows a busy state and can be canceled.
- Workers terminate on completion, failure, and dialog close. Pending parsing
  locks configuration, and obsolete previews cannot replace a later source.
- Preview store/collision summaries use memoized maps and sets.

### Added

- A reproducible Rust/Wasm scanner experiment with three compiler profiles,
  Chromium/Firefox comparisons, and 1,022 differential cases per browser.
- Before/after measurements of the compiled extension's large-file workflow.
- Worker lifecycle, file replacement, oversized-input, and native extension-CSP
  regressions. The suite has 159 unit tests, 64 browser workflows, and 14 native
  Firefox checks including the production preview worker.

Rust did not show a consistent end-to-end benefit and remains outside production
builds. The TypeScript worker improves responsiveness with about a 6% browser
package increase; review-stage latency can rise. See [the results](docs/rust-experiment.md).

## 0.1.1-preview.1 — 2026-10-12

The second unsigned GitHub preview. Browser manifests use `0.1.1`.

### Changed

- Preact replaces the React DOM renderer; advanced tools load from local chunks
  on demand. Browser ZIPs fall from about 138 KB to 84 KB.
- The popup reads its captured site's store and host scope. Cookie edits verify
  matching identities without reading the whole profile.
- Large domain lists show 50 entries initially, with complete search and Show
  more; the selected domain stays visible. The narrow-layout domain filter
  survives resizing, and hidden desktop options are no longer mounted.
- Shared domain/identity indexes, a reused date formatter, and fewer store
  enumerations reduce repeated work. Refresh has an explicit busy state.
- Dirty-draft and keyboard guards run synchronously, and nested dialogs restore
  focus after closing. Existing stale-write and cleanup safeguards are retained.
- Reproducible-source archives omit documentation PNGs while preserving build
  inputs, runtime icons, licenses, and attribution. The imagery remains in Git.

### Added

- A native-cookie benchmark with committed before/after samples and methodology.
  On the 2,000-cookie Chromium fixture, workbench startup took 59% less time;
  results are specific to the measured environment.
- Raw installed/startup JavaScript and ZIP size budgets in CI.
- Scoped-read and large-domain regressions: 153 unit tests, 58 browser workflows,
  four native Chrome workflows, and 14 native Firefox checks. Minimum versions
  remain Chrome 132 and Firefox 140.

See [the performance record](docs/extension-performance.md) and
[review](docs/review-2026-10-12-optimization.md). Store publication remains pending.

## 0.1.0-preview.1 — 2026-10-12

The first public GitHub preview. Browser manifests use `0.1.0`; packages are
unsigned and browser-store publication is pending.

### Added

- A new Cookie Loom identity and teal interface, with a current-site popup and
  full-page cookie workbench.
- A TypeScript workspace with a browser-independent cookie core and one WXT /
  React extension application targeting Chromium and Firefox Manifest V3.
- Cookie editing, search, filtering, protected cleanup, and session-only undo.
- Explicit copy-to-store controls and URL / Base64 value conversion in drafts.
- Compact layouts with a small-screen domain selector, table value reveal/copy,
  and search/help shortcuts.
- Unsaved-edit confirmation and explicit reload for cookies changed in the browser.
- Import previews and JSON / Netscape export, with legacy JSON migration.
- Explicit host-access controls and local-only settings.
- Container, first-party, and partition identity handling where browsers expose
  those capabilities.
- A synthetic-data demonstration workspace and automated checks.
- Contributor, privacy, security, architecture, migration, and release guides.
- Tagged preview releases with SHA-256 checksums, source revision metadata, and
  automated byte-for-byte source/archive verification.
- Chrome 132 and Firefox 140 baseline API checks in CI, plus browser-store
  listing copy, permission justifications, reviewer instructions, and images.
- A pinned Bun 1.4.3 toolchain for development, builds, tests, CI, and source
  reproduction, with a single text lockfile and scripts-disabled frozen installs.

### Changed

- Native Bun typechecking runs workspace checks in parallel, and the native Bun
  unit runner replaces Vitest. WXT/Vite continue to compile the browser builds.
- Development processes follow their supervisor's lifetime through Bun's
  no-orphan process handling.
- Cookie protection is a cleanup safeguard within Cookie Loom. It does not
  recreate cookies removed by websites or browser settings.
- Startup cleanup is opt-in and bound to the browser's profile-startup event.
- Local storage cleanup acts on the active origin after explicit confirmation.
- Cookie and protection updates are coordinated across extension pages; saves
  verify the written identity instead of trusting an ambiguous browser response.
- Pending saves lock the draft, and externally deleted cookies remain visible
  as unavailable records without enabling stale mutations.
- Standard Netscape imports honor the include-subdomains flag. Old Cookie Quick
  Manager text exports use an explicit compatibility option.
- The first new interface is English. Historical French and German resources
  are retained in the archive but have not been ported to the new interface.

### Historical source

The old extension and its documentation are preserved in `legacy/`. Upstream
history is credited in [NOTICE](NOTICE); the GPL license is unchanged. This
preview entry is not a claim of browser-store publication or certification.
