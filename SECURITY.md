# Security policy

## Reporting a vulnerability

Use [GitHub's private vulnerability reporting form](https://github.com/q1/cookie-quick-manager/security/advisories/new)
for this repository. Include the affected commit or version, browser/version,
reproduction steps, impact, and a minimal example using synthetic cookies.
Do not include live credentials or another person's data.

If you cannot use the form, open a public issue requesting a private contact
channel. Include no exploit details or sensitive data in that request.
There is no guaranteed response time or bug-bounty program.

Security fixes target the current Cookie Loom code. The preserved `legacy/`
extension is historical reference and is not maintained as a supported release.
Report an upstream-only issue to its upstream maintainers as appropriate.

## What the extension trusts

Cookie Loom is a privileged browser extension. With host access, the browser's
cookies API can expose authentication cookies, including HttpOnly values.
The interface masks values by default, but masking is not encryption or an
access-control boundary. Anyone who can access the browser profile or an
exported cookie file may be able to access its contents.

- Cookie fields, import files, and page metadata are untrusted input.
- Privileged cookie operations run in extension contexts. Do not expose them
  to web pages through external messages or web-accessible bridges.
- Browser permissions are checked before cookie access; broad access is an
  explicit user choice and can be revoked in browser settings.
- The shared core must not use browser APIs, execute imported code, or fetch
  remote resources. Browser mutations are validated before execution.
- A cookie's identity includes its store, domain, host-only scope, path, name, first-party
  domain, and partition key. Missing identity fields can affect another cookie.
- Cleanup protection applies to Cookie Loom's cleanup actions. It does not stop
  websites, other extensions, expiry, or browser settings from removing cookies.
- Destructive actions require a clear scope. Partial failures must remain
  visible; imports and multi-cookie operations are not browser transactions.

## Data boundaries

There is no Cookie Loom service, account, telemetry endpoint, remote script,
or cloud synchronization. Settings and protection identities are kept in local
extension storage. Cookie data remains in the browser cookie store, in memory
while in use, or in an export the user explicitly creates.

An undo buffer is temporary, best-effort session state. It is not a backup and
cannot guarantee restoration after browser shutdown, expiration, permission
changes, or an incompatible browser context. Local storage deletion has no
undo. See [PRIVACY.md](PRIVACY.md) for the complete data-handling description.

Review changes to permissions, message handlers, import/export, URL construction,
cookie identity, and mutation safeguards with particular care. Test with a
disposable profile; do not use a personal logged-in session as a test fixture.
