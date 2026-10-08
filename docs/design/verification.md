# Design verification

The [active refinement concept](workbench-refinement-concept.png) and final
browser captures were inspected directly with local image viewing. The earlier
[concept](workbench-concept.png) remains as design history.

Current screenshots use synthetic data:

- [Desktop, 1536 × 1024](workbench.png)
- [Dark desktop, 1536 × 1024](workbench-dark.png)
- [Popup, 390 × 780](popup.png)
- [Compact workbench, 390 × 844](narrow.png)

T3's preview browser could not start because the host's AppArmor policy blocks
its sandbox. Playwright provided browser rendering and interaction checks.

## Comparison

The refinement was checked for:

1. Copy: page names and action labels replace the headline/subtitle and repeated
   privacy messages. Context and safety information remain at the relevant action.
2. Layout: compact header and toolbar, narrow navigation rail, full-height table,
   right-hand inspector, and bottom status/Save controls.
3. Typography: deliberate control sizing, restrained headings, readable table
   names, and separate monospaced cookie values.
4. Palette and borders: white/zinc surfaces, neutral dark mode, fine separators,
   restrained teal selection, and no decorative gradients or card wrappers.
5. Interaction: masked values, copy/reveal, mixed selection, filtering, keyboard
   shortcuts, edit validation, stale-edit protection, and explicit discard.
6. Responsive behavior: 320/390px layouts retain filters and actions, 768/1024px
   layouts use modal editing, and desktop tables keep their own scroll region.

The screenshot comparison preserves the concept's hierarchy and utility focus.
Intentional differences are the real adapter data and the functional choices in
[the specification](README.md); there is no promotional copy added above the
workbench. Desktop and narrow layouts were checked for clipping and page overflow.

See [browser verification](../verification.md) for the automated test record,
native-extension checks, and the remaining manual release checks.
