# Migrating from Cookie Quick Manager

Cookie Loom is a separate extension and a substantial rewrite. It uses a new
interface, build system, storage model, and extension identity. Installing it
does not transfer the old extension's settings or protected-cookie list.

## A safe migration

1. Build and load Cookie Loom in a disposable browser profile first. Review
   [the privacy policy](../PRIVACY.md) and requested site permissions.
2. If you need a backup, export selected cookies as JSON from Cookie Quick
   Manager. Treat that file as sensitive: it may contain login credentials.
3. Open Cookie Loom's import preview and inspect the records and any errors.
   JSON is preferred to Netscape format because it can retain more metadata.
   For old Cookie Quick Manager Netscape text exports, enable the explicit
   compatibility option before reviewing; standard text imports use different
   domain-scope flag semantics.
4. Apply only the intended records to the intended browser store. Imports can
   partially fail because browsers enforce cookie and permission rules.
   Saved stores are preserved by default. If moving to a different profile,
   review unavailable stores and explicitly acknowledge any remapping.
5. Recreate protected cookies and cleanup preferences in Cookie Loom. Keep
   startup cleanup off until you have verified those choices.
6. Remove unneeded exports and disable the old extension if you no longer need
   it. Running two cookie managers can make the source of changes confusing.

Cookies already in a browser profile are shared browser state; installing a new
cookie manager does not itself copy, migrate, or remove them. Moving between
profiles or browsers requires an explicit transfer. Sites may reject imported
sessions, and no cookie file is guaranteed to reproduce an authenticated login.

## What carries forward

- Inspecting, creating, editing, deleting, searching, and exporting cookies.
- A quick current-site popup plus a wider workbench for detailed tasks.
- Host-only, secure, HttpOnly, SameSite, expiry, and browser-store awareness.
- Firefox containers and first-party isolation metadata where exposed.
- Protection from the extension's own cleanup, opt-in startup cleanup, and
  explicit local storage cleanup for the active page.

## Deliberate changes

- **Site access is explicit.** Cookie management requires an optional grant
  covering all HTTP/HTTPS websites. There is no per-site permission mode yet.
  The workbench can only show stores the browser permits.
- **Protection has a narrow promise.** It skips Cookie Loom cleanup actions;
  it does not restore cookies deleted by a website, the browser, or another
  extension. It is not a backup of authentication state.
- **Modern identity matters.** Containers, first-party domains, partition top-
  level sites, and partition ancestor bits stay distinct. Legacy records that
  lack those fields cannot recreate data that was never in the export.
  Chromium cannot import Firefox first-party isolation cookies; incompatible
  records must be reported instead of silently losing that information.
  Both browser adapters preserve partition ancestor bits when supplied.
- **Undo is temporary.** It is best effort within the current session, not
  recovery after restarting the browser or clearing local storage. Workbench
  deletion offers five minutes of undo while the same tab stays open; automatic
  startup cleanup has no undo.
- **No privacy setting toggles.** Cookie Loom reads supported first-party
  metadata rather than changing the browser's isolation setting.
- **Netscape exports lose metadata.** That text format cannot preserve stores,
  partitions, first-party domains, or SameSite. Prefer Cookie Loom JSON when
  fidelity matters and review warnings before importing.
- **English first.** The original French and German files are preserved in
  `legacy/`; the new interface has not yet been translated.
- **Desktop target.** The original Android screenshots describe the old
  extension. They are not evidence of Cookie Loom mobile support.

Legacy import compatibility is best effort and validated in preview. Back up
only data you are authorized to handle and never attach a real export to an
issue. Use synthetic examples when reporting a migration problem.
