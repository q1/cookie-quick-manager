# Native Firefox extension smoke test

Run `npm run build`, then `node tests/firefox/run.mjs`. Set `FIREFOX_BINARY` to use
a particular Firefox executable; otherwise the script uses an installed
Playwright Firefox binary. It does not download a browser.

The runner copies the built Firefox extension into a temporary directory and
starts `web-ext` with a fresh disposable profile. The production background
bundle runs unchanged. A separate test script bundles the actual source gateway
and exercises native Firefox cookies, containers, first-party isolation,
partitions, protection, collision checks, and extension-restart behavior.

Only the disposable manifest gains required host/container access so the actual
gateway permission check can run without an interactive permission prompt. All
fixture cookies use `*.localhost`; no user profile is opened. The sole HTTP
request from the fixture posts its result to a random loopback receiver. The
temporary browser process, profile, and extension copy are removed afterward.

This validates native APIs and background restart behavior. It does not replace
the rendered UI tests or interactive permission-prompt verification.

Verified on 2026-10-08 with Firefox 151.0 and Firefox 156.0: all 11 native checks
passed, including distinct ancestor-bit partitions, container protection boundaries,
and retaining cookies when the production background restarts with startup cleanup
enabled. These runs used newly created test profiles and synthetic cookies only.
