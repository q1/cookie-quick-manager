# Contributing to Cookie Loom

Cookie Loom is an independent, GPL-3.0-or-later rewrite of Cookie Quick
Manager. Contributions should make cookie management easier to understand
without weakening the user's control over their browser data.

## Getting started

1. Read [the architecture](docs/architecture.md) and [privacy policy](PRIVACY.md).
2. Follow [the development guide](docs/development.md).
3. Open a focused issue or pull request. Discuss substantial permission,
   storage, dependency, or product changes before implementing them.

Bug reports should include the browser and version, operating system, steps
to reproduce, expected behavior, and what happened. Use a disposable profile
and synthetic cookies whenever possible. Never attach real session tokens,
cookie exports, browsing histories, or unredacted screenshots.

For vulnerabilities, follow [SECURITY.md](SECURITY.md), not a public issue.
Please also read the [code of conduct](CODE_OF_CONDUCT.md).

## Changes we can review

- Keep changes scoped and describe the user-visible result.
- Use TypeScript for application and shared domain code. Keep browser APIs in
  the extension adapter and browser-independent rules in `packages/core`.
- Treat cookies and imports as untrusted input. Render values as text and keep
  mutation validation at the browser boundary as well as in the interface.
- Preserve the whole cookie identity: store, domain, host-only scope, path, name, first-party
  domain, and partition key. Include the partition ancestor bit when present.
- Explain any new permission or persisted field. Do not add analytics, remote
  code, automatic uploads, or production logging of cookie values.
- Provide accessible labels, keyboard behavior, focus handling, and useful
  empty/error states. Do not communicate protection or errors only by color.
- Add tests for meaningful behavior changes, particularly mutation identity,
  imports, cleanup safeguards, and browser differences. Avoid tests that only
  restate the implementation.
- Update the user documentation and changelog when behavior changes.

Before opening a pull request, run:

```sh
npm run format:check
npm audit --omit=dev
npm run check
npm test
npm run build
npm run lint:firefox
npm run test:e2e
npm run test:firefox
npm run zip
npm run verify:builds
```

The browser tests require Playwright's Chromium and Firefox installations; see the
[development guide](docs/development.md). State which browser checks you ran
and which remain untested. A successful Chromium build does not verify Firefox.
CI also checks archive integrity and publishes unsigned packages with their
corresponding source. Those artifacts are for review, not store releases.

## Sending a pull request

Create a topic branch from this repository's default branch and keep commits
focused. The current default branch is `fpi`; do not assume it is named `main`.
Target `q1/cookie-quick-manager`, not the upstream Cookie Quick Manager project.
When using GitHub CLI, pass `--repo q1/cookie-quick-manager` explicitly because
its default may resolve to the upstream repository for a fork.

Describe the behavior before and after your change, the relevant browser
versions, and checks you ran. Include screenshots for interface changes using
synthetic cookies. Call out any permission or persistent-data changes. There is
no required commit-message format or contributor agreement.

## Licensing and attribution

By submitting a contribution, you agree to license it under GPL-3.0-or-later.
Keep existing copyright and license notices. Identify copied or adapted code,
its source, and its license in your pull request. Do not relabel archived
upstream code as new Cookie Loom code. A separate contributor agreement is
not required.

The maintainers may request changes or decline contributions that add
unnecessary permissions, make destructive actions ambiguous, or create an
ongoing maintenance burden. Small, understandable changes are easier to review.
