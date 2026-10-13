# Rust/Wasm experiment and large-import improvements

Measured on 2026-10-12 against the shipped 0.1.1 preview. **Decision: keep Rust
as an optional experiment; ship the TypeScript worker and file-selection UX.**
The experiment found no consistent end-to-end Rust win across desktop Chromium
and Firefox. This is evidence about this scanner/workload, not a claim about
Rust or WebAssembly in general.

## What was actually rewritten

A dependency-free Rust scanner replaces Netscape line/tab splitting with a
single bounded scan and a batched UTF-16 offset array. JavaScript slices the
original string using those offsets, preserving valid Unicode exactly. The
same TypeScript validator and identity function enforce browser-compatible
hostname, prefix, partition, expiry, and duplicate rules. Ill-formed UTF-16 uses
the reference parser; JSON/legacy migration remains TypeScript. Browser reads,
writes, protection, and rollback were never moved into the experiment.

The scanner avoids a JSON serialization round trip and per-cookie Wasm calls.
Its experiment worker loads the local Wasm only for Netscape data. A separate
TypeScript worker is the control, isolating the benefit of moving work off the
UI thread from changing the implementation language. See [the lab](../experiments/rust-backup/README.md).

## Processing results

Medians, one warmup and seven measured samples; lower is faster. Total time
includes the worker message and complete result clone. The JSON row uses the
TypeScript fallback in the Rust-labelled worker: **Rust does not process JSON**.

| Browser      | Fixture        | UI TypeScript | TypeScript worker | Rust scanner + TypeScript worker |
| ------------ | -------------- | ------------: | ----------------: | -------------------------------: |
| Chromium 149 | netscape-2000  |        7.6 ms |            9.7 ms |                           8.5 ms |
| Chromium 149 | netscape-10000 |       48.5 ms |           64.4 ms |                          70.2 ms |
| Chromium 149 | unicode-2000   |        7.5 ms |           10.3 ms |                          10.1 ms |
| Chromium 149 | json-10000     |       41.9 ms |           59.7 ms |                          62.0 ms |
| Firefox 151  | netscape-2000  |        9.0 ms |           11.0 ms |                          12.0 ms |
| Firefox 151  | netscape-10000 |       62.0 ms |           74.0 ms |                         104.0 ms |
| Firefox 151  | unicode-2000   |        9.0 ms |           14.0 ms |                          16.0 ms |
| Firefox 151  | json-10000     |       57.0 ms |           71.0 ms |                          71.0 ms |

The 10,000-row Netscape fixture is about 9.1 MB; JSON is about 8.2 MB. Rust saves
about 1 ms on Chromium's small ASCII fixture, but loses on the large Netscape
fixture in both browsers. TypeScript remains the better tested choice for this
product. A worker incurs message/clone and startup costs even when it improves
responsiveness; worker elapsed time is not automatically lower than inline time.

On the large Netscape fixture, the median maximum UI frame gap drops from
44.5 to 16.7 ms in Chromium and from 49.4 to 17.1 ms in Firefox with the TypeScript
worker. Rust offers no further frame-gap improvement because it runs in a worker
too. These measurements cover the isolated processing page, not every UI operation.

## Size and memory

Rust 1.98.0, LTO, one codegen unit, panic abort, stripped symbols:

| Cargo profile | Raw Wasm | Gzip, level 9 |
| ------------- | -------: | ------------: |
| release       | 31,034 B |      13,898 B |
| speed         | 30,702 B |      13,432 B |
| small         | 31,343 B |      13,969 B |

The speed profile is also the smallest here; it was used for the final browser
comparison. Cargo [documents why optimization levels must be measured](https://doc.rust-lang.org/cargo/reference/profiles.html#opt-level).
Gzip is a payload estimate, not a measured browser ZIP addition. A production
integration would also need its adapter and a CSP allowance. Modern
[Chromium](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)
and [Firefox](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/content_security_policy)
support packaged Wasm with `wasm-unsafe-eval`; the shipped extension retains its
existing CSP and includes no Wasm.

For the large Netscape fixture, the Rust instance reserves about 13.4 MiB of
linear memory in addition to JavaScript data. That is a measured high-water
allocation; it is **not total browser memory, live heap use, or a leak measurement**.
The module's pages do not shrink after freeing its buffers. Worker termination
releases the instance. This experiment does not establish whole-browser memory
usage for either implementation.

The useful production worker increases the Chrome ZIP from 83,801 to about
88,866 bytes (about 6%) and installed files from 209,234 to about 223,302 bytes.
Popup/workbench startup JS remains unchanged; the worker loads on demand.
All existing 95,000-byte browser ZIP and raw JS/installed-size budgets still pass.

## Real extension workflow

The published 0.1.1 Chromium ZIP and the 0.1.2 candidate use the same 10,000-row,
8,947,807-byte synthetic Netscape file, disposable profiles, and test-only upfront
host grants. There is one warmup and five measured repetitions. File-selection
time starts at the DOM change event, excluding Playwright's file-upload setup;
frame gaps use actual callback timestamps to avoid stale rAF timestamps from
that setup. Review timing includes automation click overhead and two painted
frames after the preview appears. It is a first preview per newly opened dialog,
so worker startup and result rendering are included.

| Compiled UI metric                              |    0.1.1 | 0.1.2 candidate |
| ----------------------------------------------- | -------: | --------------: |
| File selected → ready: elapsed                  | 639.8 ms |         29.1 ms |
| File selected → ready: largest frame gap        | 480.8 ms |         16.2 ms |
| Review click → preview ready: elapsed           | 132.7 ms |        232.8 ms |
| Review click → preview ready: largest frame gap |  67.7 ms |         25.4 ms |

Selected files are passed as immutable File/Blob handles and read inside the
worker. Their multi-megabyte contents no longer expand the textarea. Small pasted
inputs retain the inline path. Large pasted inputs and selected files get a
worker that is terminated on success, failure, or cancellation; closing a dialog
cannot resurrect an old preview. Parsing configuration is locked while a preview
is pending, and preview summaries use memoized maps/sets. Cookie mutations remain
explicit, serialized, and on the existing browser gateway.

The review stage is slower in elapsed time on this file; the selection stage and
UI blocking improve substantially. The chosen tradeoff is responsive large-file
handling with a small package cost, rather than a universal throughput speedup.

## Reproduction and limitations

Use `bun run build:transfer-lab speed`, then `bun run benchmark:transfers` with
`--browser chromium` or `--browser firefox`. Rust is optional and does not become
a normal extension build dependency. Run cases sequentially without other tests
or builds. Native Rust tests cover Unicode offsets, ECMAScript whitespace, and
bounds. Each browser checks 1,022 differential cases (including malformed rows,
legacy flags, duplicate identities, mixed newlines, row limits, and UTF-16) and
compares every timed preview by a canonical hash of the complete result.

The host is Linux x64 on an AMD Ryzen 9 9950X3D, Bun 1.4.3, Chromium
149.0.7827.55 and Firefox 151.0. There is no CPU throttle. The first worker-request
sample is retained separately; it is not a fresh-machine cold-start test, and
browser Wasm code caches may already be primed by differential validation.
Long-task entries are unavailable in Firefox; zero entries there do not mean
zero blocking. The frame-gap metric is measured in both browsers.

[Chromium raw samples](benchmarks/rust-chromium.json),
[Firefox raw samples](benchmarks/rust-firefox.json),
[compiler sizes](benchmarks/rust-compiler-sizes.json), and
[compiled UI before](benchmarks/import-ui-before.json) /
[after](benchmarks/import-ui-after.json) retain all repetitions and hashes.
Use `bun scripts/benchmark-import-ui.mjs --build /path/to/chrome-mv3` to repeat
that workflow. Timing is diagnostic; correctness and size are CI gates.

This is a partial Netscape scan experiment, not a full Rust cookie-core rewrite.
Search/indexing, a fully Rust validator, native CLI reuse, and worker-side export
throughput were not evaluated. A future Rust proposal should demonstrate a
material gain including conversion, loading, memory, cross-browser correctness,
and package cost before replacing the TypeScript implementation.
