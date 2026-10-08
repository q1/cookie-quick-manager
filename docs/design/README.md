# Interface specification

The active [refinement concept](workbench-refinement-concept.png) replaces the
[initial concept](workbench-concept.png) with a quieter, denser tool interface.
The requested direction is shadcn/ui and Vercel: neutral surfaces, precise
borders, concise controls, and restrained teal accents. No slogans or repeated
privacy subtitles sit between the user and their data.

## Tokens and components

- True-white workspace, near-white navigation, zinc text and borders, and a
  deep teal primary action. Dark mode uses neutral charcoal surfaces.
- System sans-serif typography, 13px primary controls and table text, 22px page
  headings, 6px control corners, and a visible keyboard focus ring.
- Locally bundled Lucide icons and the editable `public/icon.svg` identity.
  Existing native buttons, form controls, and dialogs share semantic CSS tokens;
  the visual refinement adds no runtime component dependency.
- Compact outlined, primary, destructive, icon, and selected control variants.
  Shadows are limited to dialogs and transient feedback.

## Layout and interaction

A 208px navigation rail, flexible cookie table, and 320px inspector fill the
desktop viewport. The header contains the page name, result count, and transfer
and creation actions. A single toolbar holds search, store/current-site filters,
and utility actions. Table values start masked; explicit reveal and copy actions
are available. Metadata remains separate from cookie values.

The inspector becomes a native modal at 1180px and below. At 840px, navigation
moves above the workbench and a domain selector replaces the hidden domain rail.
At 520px, the table retains name, domain, selection, and copy controls; full
attributes remain available in the editor. Filters wrap into usable rows rather
than shrinking their labels. The demo starts with the list on compact screens.

Search accepts field operators. `/` or Ctrl/Cmd+K focuses search, `?` opens help,
and Escape closes the editor. Unsaved edits require an explicit discard action;
browser refreshes preserve the draft's original baseline and expose a reload
option when the underlying cookie changes. Destructive dialogs retain scope and
recovery information.

## Intentional differences from the concept

Real cookie names, values, dates, and protection counts come from the adapter.
All values remain masked initially, including seemingly harmless preferences.
The inspector groups related fields, retains host-only scope and validation, and
uses separate store/isolation and value-tool disclosures. Row actions expose
copy directly; no decorative or nonfunctional overflow menu is added. The
current-site filter is an explicit toggle separate from the domain filter.

The concept is documentation, not a runtime asset. The extension requires no
image generator, remote font, analytics service, or hosted component runtime.
See [verification](verification.md) for the visual comparison and browser checks.
