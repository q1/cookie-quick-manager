# Architecture

Cookie Loom is one extension with two browser builds. The popup handles quick
current-site tasks; the workbench provides space for inspection, editing,
search, transfers, and settings. Both use the same cookie model and services.

## Decision: TypeScript, React, WXT, npm workspaces

**Status:** accepted for the rewrite, 2026-10-08.

- `apps/extension` owns the React interface, extension entrypoints, browser
  adapter, manifests, assets, and synthetic-data demo.
- `packages/core` owns cookie identity, validation, filters, import/export,
  cleanup selection, and browser-independent behavior.
- WXT builds Manifest V3 packages for Chromium and Firefox from shared source.
  Browser-specific configuration and capability differences stay explicit.
- npm workspaces provide a single lockfile. TypeScript, linting, unit tests,
  and browser tests are run from the repository root.
- `legacy/` preserves the previous JavaScript / jQuery extension and store
  material. It is excluded from new application builds and active checks.

This split makes destructive behavior testable without a browser while keeping
browser permissions and API differences visible at their boundary. React
provides a common accessible component model; WXT handles extension entrypoints
and build packaging. The tradeoff is a Node-based build pipeline and a larger
dependency set than the original handwritten extension. The lockfile and
source-build instructions are part of the reviewable release input.

## Cookie identity

A name alone does not identify a cookie. The shared model keeps these fields:

```text
storeId + domain + hostOnly + path + name + firstPartyDomain + partitionKey
```

The partition key includes the top-level site and the cross-site ancestor bit
when the browser exposes them. Host-only status must be preserved when writing
cookies; security flags and expiry are data, not substitutes for identity.
Editing identity fields is a move: write the validated replacement, then remove
the old identity safely. Do not remove the old cookie if creating its replacement
failed. Browser cookie operations are individually fallible and not atomic.

Chromium and Firefox do not expose identical partition and store APIs. The
adapter translates supported fields and reports unsupported operations. It
must never silently flatten distinct containers or partitions to a shared
name/domain/path. See the official [Chromium cookie API](https://developer.chrome.com/docs/extensions/reference/api/cookies)
and [Firefox cookie API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/cookies).

## Permission model

The extension needs the cookies API and matching host access to work on a site.
The current implementation requests one optional grant covering all HTTP/HTTPS
websites before either the popup or workbench can manage cookies. A per-site
grant mode is a possible future improvement, not current behavior. Access can
be revoked at any time; the interface must handle that without treating an
inaccessible store as empty or claiming a mutation succeeded.

Other permissions support local preferences (`storage`), the current tab
(`activeTab`), optional explicit active-origin local storage cleanup
(`scripting`), and Firefox container labels (`contextualIdentities`, declared
as a required permission in that build). No browser privacy-setting
permission is used to toggle first-party isolation for the user. Consult the
generated browser manifest for the actual list and the [privacy policy](../PRIVACY.md)
for data handling. The permission requirement is documented by
[Chrome](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)
and [Mozilla](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/host_permissions).

## State and lifetimes

- Browser cookie stores remain the source of truth for cookies.
- Local extension storage persists settings and protected identities, not a
  shadow copy of every cookie value.
- Undo is temporary session state and best effort. Never rely on a long-lived
  Manifest V3 background process or promise recovery after shutdown.
- Startup cleanup is registered with `runtime.onStartup`. Loading or waking a
  background worker must not trigger cleanup. The event does not represent
  each new window or private browsing session; see [Mozilla's event documentation](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/onStartup).
- The demo adapter only operates on synthetic data. It is useful for UI work,
  but does not prove that browser permission or cookie APIs work.

## Mutation and import boundaries

Cookie values and files are untrusted. The core validates data before an import
can be applied, and the browser boundary rechecks operations. The interface
shows scope, protection skips, and failure counts. Import/export formats
have different fidelity: native JSON carries modern identity metadata;
Netscape files cannot represent container, SameSite, first-party, or partition
fields. A transfer is not necessarily a portable authenticated session.

Privileged operations run in extension contexts without a page-facing bridge.
Render data as text and bundle all runtime assets locally. New remote
dependencies, permissions, or persisted data require a documented design decision.

## Product boundaries

Cookie Loom manages browser-exposed cookies. It is not a password manager,
tracking blocker, encrypted backup service, or browser-wide storage eraser.
Protection does not block website changes. Local storage cleanup does not
clear IndexedDB, cache, service workers, or every third-party storage partition.
The current target is desktop Chromium and Firefox; Safari and mobile browsers
require separate capability and interface verification.
