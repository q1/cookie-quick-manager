# Using Cookie Loom

Start with a disposable browser profile if you are evaluating the development
preview. The local demo contains synthetic data; the installed extension acts
on real browser cookies and can sign you out of websites.

## Connect and inspect

Open Cookie Loom from the browser toolbar and choose to allow website access.
The current implementation requests access to all HTTP/HTTPS websites, even
for current-site controls. The Firefox build declares container access too. The browser
permission prompt is the source of truth; you can revoke access in its extension
settings later.

Use the popup for current-site tasks. Open the workbench for the full list,
domain navigation, store filtering, editing, import/export, and settings.
The browser only exposes stores the extension is allowed to access. An empty
list is not proof that the entire browser profile has no cookies.

The **Cookies** view lists the available records; **Protected** shows identities
marked to skip cleanup. Filter by domain in the sidebar, or use the domain
dropdown on smaller screens. Store and current-site filters can narrow either
view further.

Select a cookie to inspect it. Values are initially masked. The table's eye
button reveals or hides visible values, and each row has a copy button. On
small screens, inspect a cookie to reveal its value. Masking only hides data on
screen; a copied value may be a login credential.

## Search

Searches are local and case-insensitive. Plain text searches names, values,
domains, paths, and store identifiers. Combine terms to require all of them,
put a phrase in double quotes, or prefix a term with `-` to exclude it.

```text
domain:example.com name:session
value:"dark mode" -is:httponly
is:secure is:persistent
is:partitioned
store:firefox-container-1
path:/account samesite:lax
```

Supported fields are `domain`, `name`, `value`, `store`, `path`, `samesite`, and
`is`. Supported `is` flags are `secure`, `httponly`, `session`, `persistent`,
`hostonly`, `domain`, `partitioned`, `firstparty`, and `expired`. A domain search
is a text match, so `domain:example.com` can also match longer domain strings;
use the domain selector or current-site filter for a scoped view.

Outside a form field, press `/` or `Ctrl+K` (`Cmd+K` on macOS) to focus search,
or `?` for search help and shortcuts. `Escape` closes the inspector, asking
before discarding unsaved edits. The workbench pages long lists in groups of
100 cookies.

## Edit and clean up

Cookie identity includes the store, domain, host-only scope, path, name, first-party domain,
and partition key. Identically named cookies can be separate records. Review
the full identity before changing or deleting one. Edits stay in a draft until
you save. Closing the inspector or switching records with unsaved changes asks
whether to keep editing or discard them.

Cookie Loom refuses stale edits and ambiguous browser targets. If a refreshed
record differs from the one you started editing, **Reload cookie** lets you
inspect the current version before trying again. Reloading a dirty draft also
asks before discarding your changes.
If the cookie was deleted externally, the inspector keeps your draft but disables
mutation and reload controls. Close it and deliberately create a new cookie if
needed. Fields are disabled while a save is pending so a late response cannot
overwrite newer typing.

Protection skips a cookie during Cookie Loom deletion and cleanup. It does not
stop sites, other extensions, expiry, or the browser from deleting it. Protected
records are also skipped by imports. You can still deliberately edit a protected
cookie in the inspector.

The inspector's **Store & isolation** section shows its store and isolation
metadata. **Value tools** includes URL and Base64 encoding and decoding.
These actions replace only the draft value;
select **Save changes** to update the browser cookie. Base64 uses UTF-8, and URL
decoding preserves literal `+` characters. Conversion does not encrypt data.

**Clear unprotected** uses the current filtered view; check the view and the
confirmation before proceeding. Workbench deletion offers undo for five minutes
while that workbench tab remains open. Undo skips cookies that already exist
and may fail if access, expiry, or browser context has changed. It does not
restore local storage or automatic startup cleanup.

Startup cleanup is off by default. Enabling it deletes accessible unprotected
cookies across stores when the browser next fires its profile-startup event.
It can sign you out of accounts and has no undo. Configure protection first.

## Transfer cookies

Select cookies and choose **Copy to store** to duplicate them into a different
available store or Firefox container. Review and acknowledge the destination:
copying a login cookie deliberately shares it with that context. Source cookies
and their protection remain unchanged. Existing destination identities and
conflicting copies are skipped, and new copies are not automatically protected.

Export uses selected cookies when there is a selection, otherwise the current
filtered view. Native Cookie Loom JSON is preferred because it preserves
supported identity and security metadata. Netscape text is useful for compatible
tools, but cannot retain stores, SameSite, first-party isolation, or partitions.
Review export warnings. Neither format is encrypted.

For import, choose a file or paste data, review the store handling, and select
**Review import**. Saved stores are preserved by default so private and container
cookies are not silently moved into the normal profile. Files without store
metadata, such as Netscape text, use the selected fallback store. If a saved
store is unavailable, recreate it or deliberately choose to map all imported
cookies into one destination and acknowledge the change in isolation. Mapping
is blocked when separate source cookies would collapse into the same identity.

Review warnings and invalid rows before applying the valid records. Existing
matches are skipped unless you enable replacement, and protected records are
always skipped. Partial success is possible; inspect the completion counts.

Standard Netscape imports use the file's include-subdomains flag to determine
cookie scope. For a text export made by the old Cookie Quick Manager, explicitly
enable its compatibility option before reviewing the file: that extension wrote
the flag in reverse, so this mode derives scope from the leading domain dot.
Leave it off for Cookie Loom, curl, and other standard Netscape exports.

Browser-specific metadata cannot always move between browsers. In particular,
Chromium does not support Firefox's first-party isolation field. Cookie Loom
preserves partition ancestor bits in both adapters and reports failures instead
of intentionally flattening incompatible identities.

## Clear the current page's local storage

Open the extension from a normal website tab, go to settings, and review the
origin before confirming local storage cleanup. The extension requests optional
scripting access for this action. It clears the active main frame's local
storage only, with an origin check to avoid acting after navigation. There is
no undo. It does not clear cookies, IndexedDB, session storage, caches, service
workers, or every third-party frame's data.
