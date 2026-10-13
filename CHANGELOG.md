# Changelog

Notable user-facing changes are recorded here. Cookie Loom versions are
independent of the historical Cookie Quick Manager version numbers.

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
