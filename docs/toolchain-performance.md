# Bun toolchain measurements

Measured on 2026-10-12 on the same Ubuntu x86_64 development machine, comparing
the Node 24.19.0 / npm pipeline with the completed Bun 1.4.3 migration. These
measure development commands, not JavaScript execution inside Firefox or Chromium.

| Command                        | Before, median | Bun, median | Elapsed time reduction |
| ------------------------------ | -------------: | ----------: | ---------------------: |
| Full type checks               |        1.960 s |     0.332 s |                    83% |
| Unit suite                     |        0.355 s |     0.022 s |                    94% |
| Both production browser builds |        1.046 s |     0.758 s |                    28% |

The old typecheck used TypeScript 5.9.3; the new pipeline uses Bun's native
TypeScript 7-compatible checker for the extension, core, and tooling projects
in parallel, including `wxt prepare` and the version guard. Both checker paths
passed the extension/core projects during migration. TypeScript remains installed
for editors and build-tool libraries.

The unit suite grew from 144 tests across four files to 146 across five files.
The two new tests cover the web-ext startup compatibility patch using real local
sockets. Bun runs files in four isolated workers; tests inside a file remain
sequential so temporary global fixtures do not race.

Both build measurements include notice preparation and sequential Chromium /
Firefox WXT builds. WXT/Vite retain extension-specific entrypoints, manifests,
code splitting, and bundling. Browser code does not depend on Bun APIs. The
toolchain change alone does not establish faster cookie operations or rendering.

## Method and raw samples

Python's monotonic `time.perf_counter()` measured subprocess elapsed time with
output captured and dependencies already installed. Runs were sequential. The
test command was repeated five times; typecheck and build three times. Medians
are reported rather than the shortest run. These small, warm local samples are
indicative; they are not cold-install benchmarks or CI performance guarantees.

| Command        | Before samples, seconds           | Bun samples, seconds              |
| -------------- | --------------------------------- | --------------------------------- |
| Typecheck      | 1.954, 1.960, 1.965               | 0.339, 0.331, 0.332               |
| Unit tests     | 0.356, 0.355, 0.348, 0.357, 0.348 | 0.023, 0.022, 0.022, 0.022, 0.022 |
| Browser builds | 1.034, 1.051, 1.046               | 0.768, 0.758, 0.745               |

Baseline commands: `npm run check`, `npm test`, `npm run build` before migration.
Current commands: `bun run typecheck`, `bun run test`, `bun run build`.
The current source ZIP has also been rebuilt from a fresh frozen install rather
than reusing the development tree.

The lockfile migration retained the versions of remaining dependencies; only Bun
type packages were added and the Vitest-only dependency tree was removed. A pinned
web-ext patch replaces deprecated Node `domain` handling during Firefox startup
with explicit connection error rejection. Its regression tests and native Firefox
140/151 checks pass. It is a development tool patch, excluded from browser bundles.

`run.noOrphans` was checked separately on Linux: killing a disposable parent
process caused its Bun script and spawned descendant to terminate. This improves
cleanup after a supervisor stops a development task. It does not replace test
harness cleanup or control browser extension background lifetimes.

Official references: [Bun 1.4.3](https://bun.com/blog/bun-v1.4.3),
[native type checking](https://bun.com/docs/runtime/check),
[runtime configuration](https://bun.com/docs/runtime/bunfig), and
[lockfile migration](https://bun.com/docs/pm/lockfile).
