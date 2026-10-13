# Browser-store submission kit

Prepared for the `0.1.1` desktop preview. This is listing copy and reviewer
guidance, not a submitted or approved listing. The publisher must use their own
developer accounts; Cookie Loom has a separate identity from Cookie Quick Manager.

## Listing fields

**Name:** Cookie Loom

**Short description:** A private cookie manager with quick site controls, a full
workbench, and protected cleanup.

**Single purpose:** Let users inspect and manage browser cookies locally,
including current-site controls, editing, cleanup, and deliberate import/export.

**Full description:**

Cookie Loom puts your browser cookies in a clear, local workbench. Use the popup
for the current site, or open the full view to search, inspect, edit, and clean up.

- Inspect cookie names, domains, paths, expiry, and security attributes.
- Keep stores, Firefox containers, and supported partitions distinct.
- Protect selected cookies from Cookie Loom cleanup, confirm deletions, and use
  short-lived undo in the open workbench.
- Preview JSON and Netscape imports, export deliberately, and migrate old Cookie
  Quick Manager files.
- Work in light or dark mode with responsive controls and keyboard shortcuts.

Cookie Loom runs locally, without accounts, telemetry, cloud sync, or uploads.
Cookie values start masked. Managing cookies requires an explicit grant for all
HTTP/HTTPS websites. Protection cannot prevent deletion by websites, expiry, or
browser settings. Exports can contain usable login credentials.

Cookie Loom is an independent GPL-licensed rewrite inspired by Cookie Quick
Manager, with attribution and historical source preserved. This initial preview
targets desktop Chromium 132+ and Firefox 140+. The interface is English.

**Homepage:** https://github.com/q1/cookie-quick-manager

**Support:** https://github.com/q1/cookie-quick-manager/issues

**Privacy policy:** https://github.com/q1/cookie-quick-manager/blob/fpi/PRIVACY.md

**License:** GPL-3.0-or-later

Supply the publisher's actual support email if the dashboard requests one.
Mark the first AMO listing experimental; select desktop platforms only.

## Permission justifications

| Permission                      | Why it is needed                                                                                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cookies`                       | Read and modify the cookies the user selects or explicitly cleans up.                                                                                                                      |
| `storage`                       | Save local theme, cleanup preferences, and protected cookie identities; no cloud sync.                                                                                                     |
| `activeTab`                     | Identify the current site's URL and cookie store when the user invokes the popup, and target confirmed local storage cleanup.                                                              |
| HTTP/HTTPS optional host access | The browser cookie API requires host access. The workbench manages cookies across websites, so the user explicitly grants all HTTP/HTTPS sites. No host access is granted at installation. |
| Optional `scripting`            | Run a small bundled function only after the user confirms deletion of local storage on the active page's origin.                                                                           |
| Firefox `contextualIdentities`  | Display container names and preserve their store boundaries.                                                                                                                               |

No remote code is used. All scripts, styles, icons, and fonts are bundled or
system-provided. There is no runtime backend or data transmission to the publisher.
The Firefox manifest declares `data_collection_permissions.required: ["none"]`.

Disclose local handling of cookies and active-tab URLs accurately in each
dashboard. Cookie values can contain authentication and other sensitive data,
even though they are never uploaded. Do not equate no transmission with no
access to user data. Match dashboard declarations to [PRIVACY.md](../PRIVACY.md)
and the current store definitions; the publisher makes the final declarations.

## Uploads and images

- Chromium: upload `cookie-loom-0.1.1-chrome.zip` as a new item.
- Firefox: upload `cookie-loom-0.1.1-firefox.zip` under the stable new ID
  `cookie-loom@q1.github.io`; provide `cookie-loom-0.1.1-sources.zip` when asked
  for original source. Do not upload under Cookie Quick Manager's ID.
- Use [store assets](store-assets/) for the required 1280×800 screenshot and
  440×280 promotional image. They show the actual UI with synthetic data.
  The extension ZIP contains the 128×128 PNG icon.
- Assets are generated by `bun run prepare:store` with the local demo running.
  Review them before submission; no screenshots of real user cookies are needed.

## Reviewer test instructions

No account, payment, login, or remote test service is required.

1. Install the browser-specific build in a disposable desktop profile. A fresh
   install should show **Allow website access** and disable cookie mutations.
2. Open a normal HTTP/HTTPS page, invoke Cookie Loom, and allow website access.
   Deny/revoke this permission in a separate test and check the no-access state.
3. Open the workbench. Create a synthetic cookie for a domain you control, edit
   its value and path, and compare it with browser developer tools.
4. Mark it protected, then clear unprotected cookies. Confirm the protected
   identity survives. Undo should restore eligible deletions for five minutes
   within the open workbench tab.
5. Export synthetic cookies as JSON and preview reimport. Import preview must
   not mutate cookies until confirmed. Values are masked until explicitly revealed.
6. On Firefox, repeat with two containers and verify the stores remain distinct.
7. Optional: put a synthetic local storage entry on the current page. Confirm
   local storage cleanup and approve optional scripting access. Only that active
   origin's local storage should be emptied.

Source build: install Bun 1.4.3, extract the source ZIP, run
`bun install --frozen-lockfile --ignore-scripts`, then
`bun run build`. Outputs are `apps/extension/.output/chrome-mv3` and
`apps/extension/.output/firefox-mv3`. Builds include `bun.lock`, `bunfig.toml`,
`.bun-version`, and the pinned tooling patch, and need no publisher credentials.
The one known Firefox validator warning comes from bundled
Preact's `innerHTML` implementation; the application renders cookie text through
Preact and does not inject cookie HTML. See [development notes](development.md).

## Final publisher steps

Create or open your own developer accounts. Review and accept store terms,
provide publisher/contact details, upload these artifacts and source, complete
privacy disclosures, and submit the preview. No signing or store credentials are
included in the repository. Normal Firefox installation requires Mozilla signing.

After approval, test the signed/store-installed build, grant/revoke native
permissions, and test an upgrade preserving preferences/protected identities.
Record the actual listing URLs in the README; retain the tag and source archive.

Official guidance checked on 2026-10-12:
[Mozilla submission](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/),
[Chrome privacy fields](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy),
[Chrome image requirements](https://developer.chrome.com/docs/webstore/images), and
[Chrome developer registration](https://developer.chrome.com/docs/webstore/register/).
