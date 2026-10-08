# Cookie Loom core

Pure TypeScript cookie operations shared by the Firefox and Chromium extension. No
browser globals, network requests, framework dependencies, or persistence are used.

## Data and identity

`CookieRecord` preserves the browser cookie's value, domain scope, path, flags,
expiration, SameSite setting, store ID, first-party isolation domain, and partition
key. Times are **Unix seconds**, matching WebExtensions APIs. Session cookies omit
`expirationDate`.

`cookieKey(record)` includes the store, canonical domain, host-only scope, path, case-sensitive name,
first-party domain, partition site, and cross-site ancestor state. It does not merge
cookies across private windows, Firefox containers, or partitions. Equivalent
domain and partition-origin spelling is normalized only for identity comparison.

`cookieUrl(record)` builds a URL for browser API calls while keeping the cookie
path from changing its origin. `domainMatches(record, hostname)` respects host-only
scope. `filterCookies(records, query, { domain, storeId })` can therefore filter by
the current site without including unrelated suffix matches.

## Search

Search terms are combined with AND. Text searches names, values, domains, paths,
and store IDs, case-insensitively. Fields include `name:`, `value:`, `domain:`,
`path:`, `store:`, and `samesite:`. Double quotes keep a phrase together; a leading
minus excludes a term.

```text
domain:example.com name:session -is:httponly
value:"dark mode" is:secure
store:firefox-container-2 is:partitioned
```

Flags after `is:` are `secure`, `httponly`, `session`, `persistent`, `hostonly`,
`domain`, `partitioned`, `firstparty`, and `expired`. Unknown flags do not match.
An unfinished quoted phrase remains searchable while the user types.

## Validation and imports

`validateCookie(unknown, { now })` returns issues with `field`, `message`, and
`severity`. It checks runtime types, permitted fields, domains, paths, expiration,
cookie prefixes, SameSite, and isolation metadata. `now` is Unix seconds; `null`
disables only the expired-cookie check for lossless archival export. Browser rules
can still reject a valid portable record, for example a public-suffix domain or a
cookie too large for the implementation.

`serializeBackup(records, stores)` produces a versioned Cookie Loom JSON backup.
`importCookies(text, { storeId, now })` returns validated `cookies`, `warnings`, and
indexed/line-numbered `errors` for a review screen. It never writes cookies. The
caller must review errors and warnings, then explicitly choose whether to restore
valid rows. Existing store IDs are retained; `storeId` supplies only a missing
legacy store or a Netscape destination. A browser adapter must check that each
store exists and reject unsupported isolation metadata rather than discard it.

Input is limited to 10 MiB, 10,000 cookies, 1,000 store descriptions, and 65,536
characters per cookie string. Unknown JSON fields and future format versions fail
validation instead of being silently dropped. Expired cookies are rejected on
import so that restore cannot accidentally delete an existing cookie. Duplicate
identities are reported.

### Compatibility formats

Legacy Cookie Quick Manager JSON arrays are migrated, including string booleans,
Firefox container IDs, and first-party domains. Plain arrays of complete
`CookieRecord` objects are also accepted. Fields absent from a historic export
cannot be reconstructed.

`exportNetscape(records)` returns `{ text, warnings }`. Its output uses the standard
seven-column format, `TRUE` for subdomain cookies, and the conventional
`#HttpOnly_` domain prefix. Netscape does **not** preserve SameSite, stores, Firefox
first-party domains, or partition keys. Present every warning before letting users
export or restore this format; JSON is the recommended backup.

Cookie Quick Manager historically reversed Netscape's subdomain flag. When that
flag conflicts with the domain's leading dot, import infers the scope from the dot
and warns. This is ambiguous with Netscape files from other tools that omit a
leading dot on domain cookies: review the inferred host-only scope before restore.
Fractional expiration timestamps are rounded down during Netscape export.

## Browser differences

The core preserves non-Secure cookies from Firefox automatic state partitioning.
It warns that Chromium's CHIPS writes require Secure. The browser adapter enforces
target-specific rules and API capability checks. Cookie Loom's schema does not
represent opaque partition keys or future browser fields; those must fail visibly
at the adapter boundary instead of being converted to unpartitioned cookies.

Reference APIs: [Firefox cookies](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/cookies),
[Chromium cookies](https://developer.chrome.com/docs/extensions/reference/api/cookies),
and [Chromium storage and cookies](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies).

## Tests

From the repository root, run `npm test`. The core suite covers isolation identity,
scope, hostile paths, validation, search, JSON round trips, old exports, malformed
input, size limits, and explicit loss warnings.

License: GPL-3.0-or-later. See the repository's `LICENSE` and attribution documents.
