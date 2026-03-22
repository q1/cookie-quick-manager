# AGENTS.md

## Cursor Cloud specific instructions

This is a **Firefox WebExtension** (Manifest V2) called Cookie Quick Manager. There is no backend server or database — the extension runs entirely client-side within Firefox.

### Key tools

- **`web-ext`** (Mozilla CLI): Used for linting, building, and running the extension. Installed globally via npm. The `Makefile` references it at `../node_modules/.bin/web-ext`; a symlink at `/node_modules/.bin/web-ext` points to the global install.
- **Firefox**: Required to run the extension. Installed from Mozilla's APT repo (not snap).

### Common commands

All commands are run from the repo root (`/workspace`):

| Task | Command |
|------|---------|
| **Lint** | `make lint` |
| **Build** | `make build` (outputs `.zip` to `dist/`) |
| **Run in Firefox** | `web-ext run --source-dir=src --firefox=firefox --no-reload` |
| **Clean** | `make clean` |

### Gotchas

- The `Makefile` `WEB-EXT` variable points to `../node_modules/.bin/web-ext`. A symlink must exist at `/node_modules/.bin/web-ext` pointing to the globally installed `web-ext` binary for `make lint` and `make build` to work.
- Firefox must be installed from Mozilla's APT repo (not snap) for `web-ext run` to work in headless/CI environments. The snap version requires snap infrastructure which is unavailable in Docker/VM environments.
- Lint produces warnings (MISSING_DATA_COLLECTION_PERMISSIONS, VERSION_FORMAT_DEPRECATED, MISSING_ADDON_ID) and notices (KNOWN_LIBRARY for vendored jQuery/Bootstrap). These are expected and not errors.
- There are no automated test suites in this project. Validation is done via `make lint` and manual testing with `web-ext run`.
- All JS libraries (jQuery, Bootstrap, Moment.js, etc.) are vendored in `src/static/js/` — there is no `package.json` or npm dependency management for the extension itself.
