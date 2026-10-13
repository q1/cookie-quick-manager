# Extension performance: 0.1.0 → 0.1.1

Measured on 2026-10-12, comparing the unchanged public `v0.1.0-preview.1`
Chromium build (source `055fb2c5303e911f5a5bf6967f9fb59453fc0371`) with the
0.1.1 optimization build. This measures extension behavior, independently of
[the Bun tooling comparison](toolchain-performance.md).

## Results

Lower is better. Percentages are observed reductions, not guarantees.

| Metric                       |    Before |     After | Reduction |
| ---------------------------- | --------: | --------: | --------: |
| Workbench ready              |  490.5 ms |  201.7 ms |     58.9% |
| Search last cookie           |  198.4 ms |   90.2 ms |     54.5% |
| Edit confirmation            |  317.6 ms |  120.7 ms |     62.0% |
| Site popup ready             |  222.2 ms |   78.9 ms |     64.5% |
| Workbench initial JavaScript | 304,749 B |  69,909 B |     77.1% |
| Popup initial JavaScript     | 248,225 B |  48,950 B |     80.3% |
| Chromium installed files     | 410,787 B | 209,234 B |     49.1% |
| Chrome ZIP                   | 138,369 B |  83,801 B |     39.4% |
| Firefox ZIP                  | 138,457 B |  83,890 B |     39.4% |

The renderer vendor chunk falls from 218,775 bytes to about 19,770 bytes.
Code splitting adds a few small chunks to the complete package while avoiding
loading editor, transfers, copy tools, and settings at workbench startup.
Bundled GPL, privacy, and attribution documents remain included. The source ZIP
falls from 2,816,043 bytes to under 260 KB by excluding documentation PNGs;
it retains runtime icons and all inputs needed to reproduce both builds.

| Native browser work per sample                         | Before | After |
| ------------------------------------------------------ | -----: | ----: |
| Popup cookie records returned, 30 current-site cookies |  2,000 |    30 |
| Store enumerations at popup startup                    |      3 |     2 |
| Store enumerations at workbench startup                |      2 |     1 |
| Records returned during one same-identity edit         |  2,002 |     2 |
| Cookie `getAll` calls for that edit                    |      3 |     2 |
| Sidebar domain buttons on first render                 |  1,971 |    50 |
| Date formatters constructed for 100 persistent rows    |    100 |     1 |

## Method

Run `bun run build`, then `bun run benchmark:extension -- --output /tmp/result.json`.
For the baseline, pass `--build /path/to/unchanged/chrome-mv3` to the same script.
Do not run competing browser, test, or build jobs during the comparison.

The benchmark uses Linux x64, an AMD Ryzen 9 9950X3D, Bun 1.4.3, and Playwright
Chromium 149.0.7827.55. Each build receives a fresh temporary browser profile:
2,000 synthetic persistent HttpOnly cookies, 30 on a loopback site and the rest
on distinct registrable `.test` domains. Distinct domains avoid Chromium's
per-site cookie quota. No personal cookies or live account services are used.
UI pages run at 4× CDP CPU throttling, 1440 × 1000 pixels. The browser worker is
unthrottled in both runs. There is one warmup and seven measured repetitions.

Only the copied manifest is changed to grant test hosts up front. Product code
is unchanged. Temporary API wrappers count reads and formatter construction;
permission prompts are outside this benchmark. Workbench/popup readiness is
measured from navigation until the expected cookie count and two animation
frames. Search includes the automation fill and two frames after its one-row
result. Edit time runs from the automation save click through its success toast,
with the editor already open; it excludes first-time editor chunk loading.
Initial JavaScript is measured from actual extension page requests before ready.
ZIP bytes come from packaged browser builds; raw bytes include all installed files.

[Before samples](benchmarks/2026-10-12-before.json) and
[after samples](benchmarks/2026-10-12-after.json) retain every measured repetition,
API count, browser version, manifest hash, and startup chunk name. Timing varies
with hardware, scheduling, cache, and garbage collection; the popup has noticeably
wider baseline variation. Do not generalize this one fixture to every profile or
claim equivalent speedups in Firefox. Native tests establish functionality in
Firefox; this benchmark measures Chromium performance only.

## Tradeoffs and regression controls

The popup still needs an explicit all-website permission grant. Parent-domain
reads can return siblings that are filtered out; multi-label public suffixes
can make a query broader than the active host. There is no persistent cookie
cache, reduced mutation validation, or parallel destructive write shortcut.
Changing identity still verifies the original and handles safe rollback.

All domains remain searchable and available through Show more. The active
selected domain remains visible. Narrow layouts retain the full native domain
selector; wide layouts avoid mounting its hidden option list. Layout effects
keep dirty-draft checks and dialog focus synchronous under Preact. Restoring
focus waits one microtask for nested dialogs to close.

CI's build verifier gates installed bytes (235,000), total JavaScript (145,000),
popup startup JavaScript (55,000), and workbench startup JavaScript (85,000), for
each browser. Release preparation caps each browser ZIP at 95,000 bytes and
source ZIP at 500,000. These ceilings include headroom, not performance targets.
Timing is deliberately diagnostic rather than a noisy CI pass/fail gate.

Future work should measure worker-side import/deletion throughput, retained
heap use, and representative Firefox startup before choosing further changes.
Per-site permission grants and fully windowed mobile domain pickers would need
separate UX and browser correctness work.
