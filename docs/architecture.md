# Architecture

Cookie Loom is one extension with two browser builds. The popup handles quick
current-site tasks; the workbench provides space for inspection, editing,
search, transfers, and settings. Both use the same cookie model and services.

## Decision: TypeScript, Preact, WXT, Bun workspaces

**Status:** workspace split accepted for the rewrite on 2026-10-08; toolchain
migrated to Bun 1.4.3 on 2026-10-12.

The 0.1.1 optimization pass replaces React DOM with Preact 11.0.1 and its
compatibility layer. The same typed component and Lucide APIs remain, with
React imports aliased by the official Preact Vite preset in both builds and
the demo. React is installed for the icon library's peer contract; React DOM
and the React WXT module are removed, and React runtime code is not bundled.
Native browser and keyboard/focus regressions gate this renderer choice.
See [the measured comparison](extension-performance.md).

- `apps/extension` owns the Preact interface, extension entrypoints, browser
  adapter, manifests, assets, and synthetic-data demo.
- `packages/core` owns cookie identity, validation, filters, import/export,
  cleanup selection, and browser-independent behavior.
- WXT builds Manifest V3 packages for Chromium and Firefox from shared source.
  Browser-specific configuration and capability differences stay explicit.
- Bun workspaces provide a single `bun.lock`, frozen scripts-disabled installs,
  native typechecking, and parallel unit tests. Validation, browser tests, and
  packaging run under the same pinned runtime from the repository root.
- `legacy/` preserves the previous JavaScript / jQuery extension and store
  material. It is excluded from new application builds and active checks.

This split makes destructive behavior testable without a browser while keeping
browser permissions and API differences visible at their boundary. Preact
provides a common accessible component model; WXT handles extension entrypoints
and build packaging. Bun runs WXT/Vite and the maintenance scripts; the shipped
extension uses each browser's JavaScript engine. The tradeoff is a build pipeline
and dependency set larger than the original handwritten extension. The lockfile and
source-build instructions are part of the reviewable release input.

TypeScript remains the application language and supplies editor/tool library
types. Bun's native checker validates the extension, core, and tooling projects in parallel without
emitting browser code. Native Bun tests replace Vitest; Playwright and the
Firefox harness verify compiled browser behavior. `run.noOrphans` also keeps
development child processes tied to their supervisor. See
[development details](development.md) and [toolchain measurements](toolchain-performance.md).

The popup reads only its captured tab's store and applicable host scope.
Parent-domain queries preserve cookies on every path, with a final host-only
and domain-applicability filter; partitions and Firefox FPI remain distinct.
The workbench reads every accessible store, reusing the current refresh's
store enumeration. Cookie edits validate the exact namespace instead of
enumerating the whole profile. Mutation serialization and stale-write checks
remain required.

Domain summaries and the identity index are computed once per cookie snapshot.
The sidebar shows 50 domains at a time, with search and incremental expansion;
the selected domain remains visible. The mobile domain selector is mounted
only at the CSS breakpoint. Editor, transfers, copy tools, and settings load
from local chunks on demand. Draft guards and dialog focus use layout effects
so deferred effects cannot allow a quick navigation to discard unsaved data.

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
After a write, resolve the saved record from its complete identity; Firefox's
`cookies.set()` return value can refer to another matching cookie. Never use an
unverified response as a rollback or deletion target.

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
- The background context coordinates cookie and preference mutations from all
  extension pages. Protection changes add or remove identities inside that
  queue, avoiding a read-modify-write race between a popup and a workbench.
  Website and browser writes remain outside this queue; stale records and
  ambiguous browser targets are rejected where the API can detect them.
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
Mutation messages use an explicit operation allowlist and accept only this
extension's own pages. Read operations and user-gesture permission requests
stay in the originating page. Local storage cleanup checks the source origin
inside the target frame and requires an explicit success acknowledgement.
Background replies use `sendResponse` with an explicit `return true`, preserving
compatibility with Chromium versions that do not support Promise-returning
message listeners.
Render data as text and bundle all runtime assets locally. New remote
dependencies, permissions, or persisted data require a documented design decision.

## Product boundaries

Cookie Loom manages browser-exposed cookies. It is not a password manager,
tracking blocker, encrypted backup service, or browser-wide storage eraser.
Protection does not block website changes. Local storage cleanup does not
clear IndexedDB, cache, service workers, or every third-party storage partition.
The current target is desktop Chromium and Firefox; Safari and mobile browsers
require separate capability and interface verification.

## Large import processing

In 0.1.2, selected files and large pasted inputs use a disposable TypeScript
worker. File handles are read in the worker; the textarea stays available for
paste input without rendering multi-megabyte selected files. The client
terminates workers on completion, failure, or abort. Configuration is locked
while parsing, and an aborted result cannot overwrite a subsequent preview.
The same core validator runs in both inline and worker paths. Mutations stay
on the existing serialized gateway.

The [Rust/Wasm experiment](rust-experiment.md) remains outside production after
comparison with the TypeScript controls. The optional CI checks parity; Rust
is not required to build or reproduce the browser packages.
