# Store images

- `workbench-light.png` and `workbench-dark.png`: actual demo UI at 1280×800,
  with synthetic cookies and values masked. Suitable for Chrome's full-bleed
  screenshot field and the AMO gallery. They show the desktop workbench.
- `promo.png`: 440×280 brand image for Chrome's required small promotional tile.
  Its editable source is `promo.svg`; it uses the extension's existing link mark.
- Extension icon: `apps/extension/public/icons/128.png`, also bundled in the ZIP.

To regenerate, start `bun run dev`, install the Playwright Chromium browser if
needed, then run `bun run prepare:store` in another terminal. The generator checks
the demo title, rendered cookie table, and application console before capturing.
Review the images after UI changes and before a store submission. Do not replace
synthetic fixtures with real browser data.

Chrome's [image requirements](https://developer.chrome.com/docs/webstore/images)
specify the dimensions above. No store listing has been submitted by generating
these images.
