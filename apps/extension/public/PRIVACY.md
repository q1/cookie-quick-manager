# Cookie Loom privacy policy

Effective date: 2026-10-08. This policy describes the new Cookie Loom extension,
not the archived Cookie Quick Manager extension in `legacy/`.

Cookie Loom runs in your browser. It has no accounts, analytics, advertising,
telemetry, external fonts, remote application code, or cloud synchronization.
Its runtime does not send your cookies, browsing data, or settings to a Cookie
Loom server. Installing dependencies, updating the extension through a browser
store, and following a documentation link involve the respective external
services under their own policies.

## Data used on your device

- **Cookies:** Cookie names, values, domains, paths, security flags, expiry,
  stores, and available partition metadata are read to display and manage the
  cookies you permit the extension to access. Cookies may include login tokens
  and other sensitive information, including HttpOnly cookies.
- **Active tab:** The current tab's URL and cookie store identify the site for
  popup controls. The extension does not keep a browsing-history database.
- **Local settings:** Theme, cleanup preferences, and protected cookie
  identities are saved in local extension storage. Protection records include
  identifying metadata such as domain and name, not a backup of cookie values.
- **Temporary data:** Displayed values, pending imports, and undo data are held
  for the active session or interface lifetime. Temporary state may disappear
  when the interface closes. Workbench undo holds deleted cookie records in
  memory for up to five minutes, until replaced by the next deletion, used,
  or the tab closes.
- **Exports:** Files and clipboard exports are created only when you choose
  them. They can contain unencrypted login credentials and remain wherever you
  save or paste them. The extension does not delete those copies for you.

Imports are processed locally. The demonstration workspace uses synthetic
cookies and does not access real browser cookies.

## Permissions and control

Cookie access requires the `cookies` permission plus host access. Cookie Loom
requests access to all HTTP/HTTPS websites when you choose to enable cookie
management, including current-site controls. A per-site grant mode is not yet
implemented. The Firefox build also declares container access as a required
permission. You can revoke website access in your browser's extension settings. A full-browser view
only includes stores and hosts that the browser allows the extension to access.

The extension also uses:

- `activeTab` to identify the current site after you invoke the extension;
- `storage` to save the local preferences and protection identities above;
- optional `scripting`, requested when you choose active-page local storage
  cleanup;
- Firefox `contextualIdentities` to label container stores.

The authoritative requested permission list is the manifest generated for
your browser; see [the architecture notes](docs/architecture.md). No persistent
content script tracks your page activity. Local storage cleanup is restricted
to the active page's origin and requires confirmation. It does not clear every
kind of site data or log the previous local storage contents.

## Deletion and retention

You control cookie deletion through Cookie Loom or your browser. Cookie
protection only affects Cookie Loom cleanup; it does not override websites,
cookie expiry, other extensions, or the browser's deletion settings. Opt-in
startup cleanup operates when the browser fires its profile-startup event.

Use browser extension settings to revoke permissions and remove the extension.
Removing the extension normally removes its own local settings, but does not
remove browser cookies or copies you exported. Browser-specific behavior and
temporary development installations may retain extension state; use a fresh
profile when testing deletion behavior.

## Questions and changes

For a privacy question, open a [repository issue](https://github.com/q1/cookie-quick-manager/issues)
without sharing real cookie values or private browsing details. For a security
issue, use [the private reporting process](SECURITY.md). Changes to data use or
permissions must update this policy and the changelog.
