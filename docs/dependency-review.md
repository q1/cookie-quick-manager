# Dependency review

Checked on 2026-10-12 with Bun 1.4.3 and the committed `bun.lock`.

`bun audit --prod` reports **zero production dependency advisories**, checking
three packages after the Preact renderer change (previously four). The full `bun audit` reports one high-severity `node-forge`
advisory through `web-ext` and `@devicefarmer/adbkit`:
[GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv).
The registry currently offers no patched release for this advisory.

Preact 11.0.1 and its compatibility layer replace the bundled React DOM runtime.
The pinned [official Vite preset](https://github.com/preactjs/preset-vite) aliases
React imports in both production and demo; React remains installed to satisfy
Lucide's peer contract. The browser bundle contains Preact, Lucide, and WXT's
browser adapter, with regenerated MIT/ISC notices. Review the renderer warning
exception and browser regressions when updating this dependency.

The historical 2026-10-08 npm audit also found zero production advisories. Its
full-tree report listed four high-severity entries for this same advisory,
propagated through the development dependency chain. Those counts describe the
older audit output; the Bun migration does not resolve the underlying advisory.

That dependency belongs to web-ext's Android debugging transport. It is not
part of Cookie Loom's browser bundles or desktop cookie operations. Android
deployment is outside this release's supported target. Do not use the tooling
to verify untrusted signatures; review the advisory before adding Android
debugging to the supported workflow.

The lockfile uses current web-ext and pins a patched `shell-quote` override to
remove a separate development command-injection advisory. Do not force framework
downgrades simply to hide the report. Recheck the full
tree on dependency updates and remove the override when upstream no longer
needs it.

## Bun compatibility patch

`patches/web-ext@10.7.0.patch` changes web-ext's Firefox remote-debugging startup
to reject connection errors explicitly instead of relying on deprecated Node
`domain` handling. It preserves the startup retry for `ECONNREFUSED` under Bun.
Two real-socket unit regressions cover the failure and successful connection
paths, and the native Firefox suite verifies browser startup through the patched
tool. The patch applies only to development tooling and is excluded from browser
bundles. The source ZIP includes it so frozen installs reproduce the same tool.

Review this patch when upgrading web-ext or Bun. Remove it once the unpatched
version passes the connection regressions and native Firefox suites under the
pinned Bun runtime. It does not address the separate node-forge advisory.

Runtime third-party notices are generated from installed package metadata and
license texts by `bun run prepare:assets`, and bundled with both extensions.
Install release inputs with `bun install --frozen-lockfile --ignore-scripts`;
the repository trusts no dependency lifecycle scripts.
