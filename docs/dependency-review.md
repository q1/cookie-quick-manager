# Dependency review

Checked on 2026-10-08 with the committed npm lockfile.

`npm audit --omit=dev` reports **zero production dependency advisories**. The
full development tree reports four high-severity entries, all from the same
`node-forge` advisory propagated through `@devicefarmer/adbkit`, `web-ext`, and
WXT. The registry currently offers no patched `node-forge` release for
[GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv).

That dependency belongs to web-ext's Android debugging transport. It is not
part of Cookie Loom's browser bundles or desktop cookie operations. Android
deployment is outside this release's supported target. Do not use the tooling
to verify untrusted signatures; review the advisory before adding Android
debugging to the supported workflow.

The lockfile uses current web-ext and pins a patched `shell-quote` override to
remove a separate development command-injection advisory. Do not force npm's
suggested framework downgrades simply to hide the report. Recheck the full
tree on dependency updates and remove the override when upstream no longer
needs it.

Runtime third-party notices are generated from installed package metadata and
license texts by `npm run prepare:assets`, and bundled with both extensions.
