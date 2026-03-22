# Chromium MV3 Parity Report

Date: 2026-03-22

This report summarizes the parity-focused QA work completed for the Chromium/Manifest V3 port against the original Firefox extension behavior.

## Test setup

### Fixture environment

Deterministic fixture pages were used instead of arbitrary live sites:

* HTTP: `http://lvh.me:4173/`
* HTTPS: `https://lvh.me:4443/`
* subdomain variants on `sub.lvh.me`

These fixtures support:

* host-only and domain cookies
* page-driven cookie deletion
* LocalStorage seeding/clearing
* secure-cookie testing on HTTPS

### Baseline Firefox extension

The original Firefox artifact from `dist/cookie_quick_manager-0.5rc2.zip` was extracted and launched with `web-ext` for comparison.

### Chromium target

The ported extension was loaded from `build/` as an unpacked Manifest V3 Chromium extension.

## Chromium verification performed

### Manual GUI smoke checks

Confirmed manually in Chromium:

* unpacked extension loads successfully in `chrome://extensions`
* popup opens successfully
* site-specific popup entries appear on the fixture page
* popup counts looked plausible for:
  * current-site cookies
  * current-store cookies
  * current-site LocalStorage
* manager page opens and lists seeded fixture cookies

### Automated Chromium QA

Executed with:

```bash
npm run qa:chromium
```

Passing checks:

* fixture seeding
* manager domain listing
* protected-cookie restoration after page-driven deletion
* cookie editing
* JSON export
* direct JSON restore
* delete cookie
* JSON import round-trip
* secure cookie creation on HTTPS
* hidden Firefox-only FPI control on Chromium options page

Latest successful result set:

```json
{
  "ok": true,
  "results": [
    {"check": "fixture-seeding", "status": "passed"},
    {"check": "manager-domain-list", "status": "passed"},
    {"check": "protected-cookie-restore", "status": "passed"},
    {"check": "edit-cookie", "status": "passed"},
    {"check": "export-cookie-json", "status": "passed"},
    {"check": "direct-json-restore", "status": "passed"},
    {"check": "delete-cookie", "status": "passed"},
    {"check": "import-cookie-json", "status": "passed"},
    {"check": "create-secure-cookie", "status": "passed"},
    {"check": "options-hide-fpi", "status": "passed"}
  ]
}
```

## Firefox baseline verification performed

The Firefox baseline was inspected through Firefox's remote debugging protocol against the temporary add-on session launched by `web-ext`.

Executed with:

```bash
python3 qa/firefox-baseline-rdp.py
```

Passing checks:

* fixture seeding
* manager page opens
* manager lists seeded `.lvh.me` and `lvh.me` domains
* host-only cookie can be selected from the manager
* single-cookie protection state can be normalized to locked
* protected host cookie survives page-driven deletion after the protection state is normalized

Latest successful result set:

```json
{
  "ok": true,
  "results": [
    {"check": "fixture-seeding", "status": "passed"},
    {"check": "manager-domain-list", "status": "passed"},
    {"check": "select-host-cookie", "status": "passed"},
    {"check": "protect-state-normalized", "status": "passed"},
    {"check": "protected-cookie-delete-from-page-js", "status": "passed"}
  ]
}
```

## Parity conclusions

### Verified equivalent or acceptably equivalent behavior

* manager page opens successfully in both Firefox baseline and Chromium port
* seeded host-only/domain cookies are visible in the manager
* single-cookie protection works and prevents page-driven deletion
* cookie edit flow works in Chromium
* JSON export/import round-trip works in Chromium
* secure cookie creation works in Chromium on HTTPS fixtures

### Intentional Chromium substitutions

These are expected platform substitutions, not regressions:

* **Firefox containers / contextual identities** → **Chromium cookie stores**
* **Firefox FPI UI / setting** → hidden on Chromium
* **Firefox panel window behavior** → tab by default, standard popup window when windowed mode is selected

### Remaining QA limitations

The highest-value parity scenarios are covered, but not every historical UI path was fully automated on both browsers.

Not exhaustively automated yet:

* Firefox popup quick-action counts
* full Firefox export/import round-trip through UI
* Firefox options persistence matrix
* incognito/store comparison matrix on both browsers

These are follow-up QA opportunities rather than known failures.

## Overall signoff

The Chromium port now has strong evidence for core parity on the most critical user-facing workflows:

* cookie discovery/listing
* single-cookie editing
* single-cookie protection and restore behavior
* JSON import/export
* secure cookie creation
* Chromium-specific platform substitutions documented clearly

At this point, the Chromium MV3 port is in good shape for a parity-first release candidate, with deeper modernization intentionally deferred until after this parity pass.
