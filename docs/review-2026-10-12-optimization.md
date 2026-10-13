# Optimization review — 2026-10-12

Scope: the 0.1.1 preview compared with the released 0.1.0 tree at
`055fb2c5303e911f5a5bf6967f9fb59453fc0371`. This is a self-review of the complete
change; the automated PR review is additional evidence, not the release gate.

## Findings addressed

- React DOM dominated installed bytes. Preact 11.0.1 uses the official Vite
  alias preset in production and demo, preserves the typed component APIs,
  and removes the React DOM/WXT React dependencies. Local feature chunks defer
  editor, transfer, copy, and settings code. Production verification rejects
  development/prefresh code; source reproduction compares every output file.
- Every refresh enumerated stores twice. The workspace passes its current
  store IDs to the read adapter. The popup restricts reads to its captured tab's
  store and host, retaining parent domain paths, Firefox FPI, and partitions.
  Applicable-host filtering excludes host-only parents and sibling sites.
  IP addresses are not split into parent queries; localhost parents are retained.
- Every edit read the whole profile to validate its original. The adapter now
  reuses the exact candidate snapshot for unchanged identity and queries the
  original namespace for moves. Collision, stale-value, partition ancestor,
  post-write verification, serialization, and rollback checks remain intact.
- Large profiles rendered every sidebar domain and a hidden desktop select.
  The sidebar renders 50 domains initially, adds batches, searches the complete
  summary, and retains the active domain. The mobile selector follows the CSS
  breakpoint and preserves the filter on resizing. No cookie rows are discarded.
- Date formatting created a formatter per persistent row. One formatter per
  document replaces that work. Duplicate row labels are indexed in one pass;
  identity lookup and domain summaries follow immutable cookie snapshots.
  Memoized context values prevent toast-only changes from broadcasting a new
  workspace value. Manual refresh cancels a pending scheduled refresh and shows
  its busy state.
- Initial renderer QA caught deferred dirty-draft/keyboard effects and nested
  dialog focus restoration. Layout effects install guards before the next
  interaction; a microtask restores focus after nested dialogs close. The
  original compact Escape regression now passes without weakening its assertion.
- Documentation PNGs inflated the source ZIP while contributing no build input.
  They remain in Git; runtime icons, code, config, lockfile, patch, and notices
  remain in the archive. New raw and ZIP budgets gate future size increases.

## Validation

- 153 Bun tests across five files, including scoped reads, revoked access,
  development hosts, and bounded edit reads.
- 58 Playwright workflows on Chromium 149 and Firefox 151, including five
  responsive widths, compact/nested-dialog focus, resize filtering, and four
  compiled Chromium extension workflows. The new native workflow verifies
  large domain search/expansion and a popup with parent-path/partition cookies.
- 14 native Firefox 151 checks, with scoped parent paths, siblings, FPI,
  partitions, container boundaries, protected cleanup, and background lifecycle.
- Frozen Bun 1.4.3 installation, production dependency audit, formatting,
  native typecheck, both MV3 builds, Firefox validation, size/resource checks,
  and a fresh source-archive rebuild reproducing all 27 files per browser.
- The same native workflows also run on Chrome 132 and Firefox 140 in required
  CI. Their green result is required before merge and again during publication.

One Firefox validator warning is explicitly limited to Preact's vendor chunk.
The reviewed source is `preact/src/diff/index.js:669`, implementing its opt-in
`dangerouslySetInnerHTML` property. Application source prohibits that property
and other HTML insertion sinks; cookie data renders through text nodes. The
wrapper rejects all other warnings and any increase in this reviewed count.

## Remaining limits

The [benchmark](extension-performance.md) measures Chromium on one synthetic
large profile. It does not establish Firefox timing, cold-machine performance,
worker import throughput, or heap retention. Parent-domain queries may return
siblings before applicability filtering, especially on multi-label suffixes.
No persistent cookie cache or weaker write validation was introduced.

Native permission dialogs, signed store installation and upgrades, and real
private-window UI remain manual release checks. Store publisher access is still
needed; this release is an unsigned GitHub preview. The development-only
node-forge advisory remains documented in [dependency review](dependency-review.md).
