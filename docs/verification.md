# Browser verification checklist

Use a new browser profile and synthetic cookies on local HTTP/HTTPS fixtures.
Record the exact browser version, operating system, commit, and build commands.
Run against the production build as well as the development interface before
a release. Automated demo tests are useful but do not replace these checks.

## Automated coverage and limits

`npm run test:e2e` runs the demo workflows in desktop Chromium and Firefox,
plus 320-, 390-, 768-, 1024-, and 1440-pixel layout checks. It covers CRUD, hidden values, search and
store filtering, protected cleanup and undo, import preview and isolation
safeguards, file export, copy-to-store, value conversion, keyboard dialogs,
themes, popup navigation, unsaved edits, stale-edit protection, value copying,
keyboard shortcuts, pending saves, deleted records, and explicit legacy Netscape
scope handling. It also loads the unchanged Chromium artifact
to check its no-host-access state, then uses a disposable copy with test-only
host grants for real cookie operations. No cookie API mocks are used in those
native extension checks.

`npm run test:firefox` exercises Firefox's native cookie, store, container,
partition, first-party isolation, and background lifecycle APIs in a disposable
profile. Its temporary artifact also adds test-only host grants and a fixture
page that exercises the unchanged production background's mutation coordinator.
These harnesses
leave the production manifests unchanged. Accepting/rejecting native optional
permission prompts, store installation/signing, and real private-window UI
remain manual checks.

The T3 preview browser was unavailable in the development environment because
its Chromium sandbox was blocked by AppArmor. Playwright was used for browser
verification. That environment limitation does not count as a passed browser
permission test.

### Local verification record

On 2026-10-08, the reviewed rewrite passed 144 unit tests, 57 Playwright tests, and
13 native Firefox API checks. The Playwright runs used Chromium 149 and Firefox
151, including the responsive viewport matrix. The native Firefox run used Firefox 151.
Both browser builds completed, and the Firefox validation wrapper reported no
errors or unexpected warnings (with the two reviewed React vendor warnings
described in the development guide).

The [independent review record](review-2026-10-08.md) describes the reproduced
findings and their corrections. Native Firefox checks include editing coexisting
host-only/domain cookies and concurrent requests from an extension page to the
production background coordinator. Unit checks also exercise callback-only
message delivery for older supported Chromium versions.

Both extension archives were inspected for the expected manifests and bundled
license notices, with no demo entrypoints or legacy code. The source archive
was extracted into an empty directory, dependencies were installed from its
lockfile with `npm ci --ignore-scripts`, and `npm run build` reproduced all 22
files in each browser build byte for byte. The source archive includes the
shared core package and root build scripts; see the [release guide](releasing.md).

These are local development results, not store review or a compatibility
certification. Minimum-version browsers, native permission dialogs, signed
installation/update paths, and mobile browsers still need separate verification.

## Permissions and navigation

- A fresh installation has a useful no-access state.
- Grant website access; the popup shows the current site and the workbench
  can show accessible browser stores. The prompt accurately describes the
  current all-HTTP/HTTPS-websites grant.
- Grant and revoke access. Refreshing reflects the permission state
  without reporting inaccessible data as a successful empty result.
- Internal browser pages, new tabs, and closed active tabs show understandable
  states instead of attempting unsupported operations.
- The popup opens the workbench, and keyboard focus and dialogs work without
  a mouse in both themes and with reduced motion enabled.

## Cookie correctness

- Create, edit, and delete host-only and domain cookies with matching names.
- Keep cookies with the same name but different paths separate.
- Check session and persistent cookies, expiry, Secure, HttpOnly, and SameSite.
- Changing identity creates the replacement before removing the original;
  an invalid replacement leaves the original intact.
- Refresh after external changes and verify the displayed state matches the
  browser's own developer tools.
- Check meaningful failure messages for invalid input and revoked access.

## Browser-specific contexts

- Firefox: create the same cookie in two containers and verify isolation during
  editing, protection, cleanup, import, and export.
- Firefox: where first-party isolation is available, verify a first-party
  domain remains part of mutation identity.
- Chromium and Firefox: create available partitioned cookie fixtures. Verify
  top-level partition sites remain distinct. Check the ancestor bit in both
  browsers where supported.
- Verify normal and private/incognito stores separately if extension access to
  private windows is enabled. Do not assume a private window fires startup
  cleanup; document unsupported cases.

## Cleanup and recovery

- Protected cookies survive Cookie Loom cleanup; an identically named cookie
  in another path, store, or partition is handled independently.
- Review a destructive action's site/store scope and cancellation behavior.
- Test session-only cleanup and all-cookie cleanup separately.
- Check session undo restores eligible deleted cookies and reports failures.
- With startup cleanup enabled, restart the profile and verify its behavior.
  Waking/reloading the background task must not run startup cleanup.
- Confirm that website/browser deletion is not advertised as protected or
  automatically restored.
- Confirm active-origin local storage deletion requires confirmation and does
  not claim to clear IndexedDB, cookies, or another origin's storage.

## Transfers and packaging

- Preview valid native JSON, legacy JSON, and Netscape files without mutating
  anything. Invalid records show actionable errors.
- Round-trip native JSON with all supported identity fields and empty values.
- Verify warnings for Netscape metadata loss and unsupported target contexts.
- Check partial imports show counts/errors and never silently move stores.
- Confirm values are masked initially and exported files are explicitly created.
- Inspect both generated manifests and extension consoles for unexpected
  permissions, network requests, remote scripts, or build-time demo data use.
- Run the packaged extension tests described in the repository. Record any
  browser capability that could not be verified; do not mark it passed.
