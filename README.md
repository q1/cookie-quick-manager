# Overview

Cookie Quick Manager is a complete manager for cookies accumulated during browsing.
It allows you to view, edit, create, delete, backup, restore, and search cookies by domain names.
The current codebase is being ported to Chromium as a Manifest V3 extension while preserving the original Firefox-oriented feature set as closely as Chromium allows.
In addition, the LocalStorage of the page viewed can be deleted (see below).

Cookie Quick Manager is designed for developers, testers or people
concerned about their privacy on the Internet.

This WebExtension is compatible with Firefox 57 and is inspired by addons like [Cookies Manager+](https://addons.mozilla.org/fr/firefox/addon/cookies-manager-plus/) and [Advanced Cookie Manager](https://addons.mozilla.org/fr/firefox/addon/cookie-manager/) whose development has been discontinued due to the withdrawal of the support for "Legacy" extensions.

**November 2018: Cookie Quick Manager is now available on Android!**

<p align="center">
<img  src="https://raw.githubusercontent.com/ysard/cookie-quick-manager/fpi/AMO/screenshots/github.png">
</p>


# Chromium / Chrome status

This branch now targets **Chromium Manifest V3**.

Most of the original functionality can be preserved, but Chromium does not expose exact equivalents for two Firefox-only capabilities:

* **Containers / Contextual Identities** → replaced by generic **cookie stores** (default store, and a separate incognito/private store when Chromium allows it).
* **First-Party Isolation** → Firefox-only. The related Firefox setting is not exposed on Chromium, so that UI is hidden there.

Other important Chromium-specific notes:

* The background logic now runs in an **extension service worker**.
* The old Firefox panel window behavior is replaced by opening the manager in a **tab** by default, or a regular Chromium **popup window** when windowed mode is selected.
* To manage private/incognito cookies in Chromium, users must enable **Allow in Incognito** for the extension.


# Development / local loading

## Build the Chromium extension

```bash
npm install
npm run build
```

This creates a loadable unpacked extension in `build/`.

## Load directly from `src/` during development

The `src/` directory is also loadable as an unpacked extension now.

If you want the simplest development loop, you can point Chrome directly at:

```text
/path/to/repo/src
```

This is useful when you want to test source changes without first generating `build/`.

## Load unpacked in Chromium

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `build/` directory

## Local QA fixture site

The repository includes a local fixture server used to QA cookie, LocalStorage, subdomain, and protection behavior deterministically.

Generate a development certificate once:

```bash
npm run fixture:cert
```

Start the HTTP + HTTPS fixture server:

```bash
npm run fixture:start
```

Fixture entry points:

* `http://lvh.me:4173/`
* `http://sub.lvh.me:4173/`
* `https://lvh.me:4443/`
* `https://sub.lvh.me:4443/`

`lvh.me` and its subdomains resolve to `127.0.0.1`, which makes them convenient for domain/subdomain cookie testing.

## Focused Chromium QA

Run the current automated Chromium regression checks:

```bash
npm run qa:chromium
```

The script loads the unpacked MV3 extension into Playwright Chromium and verifies:

* fixture seeding on the QA site
* domain listing in the manager UI
* protected-cookie restoration
* cookie editing
* JSON export/import round-trip
* secure cookie creation on HTTPS
* Chromium options behavior (including hidden Firefox-only FPI control)

## Firefox baseline parity check

To compare against the old Firefox build:

1. Extract / launch the baseline extension with `web-ext`, for example:

```bash
unzip -q -o dist/cookie_quick_manager-0.5rc2.zip -d qa/firefox-baseline-extension
npx web-ext run --source-dir=qa/firefox-baseline-extension --firefox=/usr/bin/firefox --start-url=http://lvh.me:4173/ --no-input
```

2. In another terminal, run the remote-debugging parity probe:

```bash
python3 qa/firefox-baseline-rdp.py
```

See `qa/PARITY_REPORT.md` for the latest recorded parity summary.


# Features

* User friendly: Clear and structured user interface. Each parameter and functionality is described when the mouse is over the element.
* Windowed and tab mode: Choose the opening in a tab to get a wider view.
* Transparency and security: The source code is free (under GPLv3) and # published on a public platform, the only way to allow reviews and external contributions.
* Search: A user can search for cookies of a domain and subdomains which depend on it.
* Edit/Create: All the attributes of a cookie can be modified: domain, path, name, value, expiration date, as well as secure and httponly flags.
* Delete: Remove the cookies of the current website in two clicks.
* Export: The export and import of a cookie or cookies from a domain in JSON or Netscape format is just as easy.
* First-Party Isolation: Supported with some limitations (due to API bugs) on Firefox 59, 60, and 61, and without limitations on Firefox 62 (scheduled on September 2018).
* Stores / contexts: On Firefox, contextual identities (containers) are supported. On Chromium, the equivalent UI works with browser cookie stores instead.
* SameSite: The SameSite flag is supported. This is a partial protection against the risks associated with Cross-Site Request Forgery (CSRF) and Cross-Site Script Inclusion (XSSI) attacks, implemented since Firefox 63.
* Cookie protection: Delete cookies except protected ones, with two clicks at anytime from the website you are viewing. An option can also prevent cookies from being deleted by the sites themselves.
* Protection of session cookies: Session cookies can be protected in two clicks to prevent accidental logout from websites after cleaning normal cookies.
* Cleaning and privacy: Can automatically delete all cookies at startup.
* LocalStorage: Keys/values of the page viewed can be deleted.


# Privacy

This addon does not store or leak any personal information.

It requires the following permissions to operate:

* Host permission for all urls: This allows you to edit the cookies and to delete the Localstorage of any site visited.
* Cookies: Allows access to the browser's cookie store.
* ActiveTab: Allows access to the currently consulted url, and its favicon if it exists.
* Scripting: Used on Chromium to read the LocalStorage item count from the current tab.
* Storage: Allows the storage of the following user settings:
    - size of the windowed mode,
    - protected cookies (only the name of the domains),
    - the template used to import/export the cookies,
    - the skin.
* Browsing data: Enables extensions to clear the data that is accumulated while the user is browsing (LocalStorage here).
* Contextual Identities: Firefox only. Allows the addon to list the containers.
* Privacy: Firefox only. Access and modify various privacy-related browser settings (the FirstPartyIsolation flag here).
* ClipboardWrite (optional): Allows the export of cookies to the clipboard from Firefox 63.


# About cookie protection

The protection of cookies is limited to the current addon actions, to the deletions that can be made by the sites themselves, or to the deletions made in the browser's "Cookies and Site Data" options.
This means that if you choose the browser option to delete all cookies when it closes, the addon will be unable to restore them (the method used by the browser does not send the necessary signal to notify the addon). However, a similar option is reimplemented in the addon itself in order to keep only the protected cookies when restarting the browser.


# What is "Delete Current Site Local Storage" on the popup menu?

This item allows a user to delete LocalStorage keys from the viewed page.

The LocalStorage is a quite new feature of HTML5 that allows developers to create data in your browser using JavaScript. Cookies are just one type of storage among others.
You will also find the term "SessionStorage", a LocalStorage where data is stored temporarily (deleted on browser restart), but the important thing is that LocalStorage is persistent, and cleared only at the discretion of the visited websites.
You may erase all of the LocalStorage store by following the procedure described in the [documentation of Firefox](https://support.mozilla.org/en-US/kb/delete-cookies-remove-info-websites-stored#w_delete-all-cookies), and by selecting "Offline Website Data".

From the point of view of privacy and security:

This kind of persistant data (even after clearing cache), was invented to store small data allowing the operation of online applications, but also offers new and better accurate ways of tracking thanks to the memorization of private or identifying data.


# Support & source code

The extension is still in development with the launch of Firefox Quantum; questions, bug reports and feature requests are open on the [GitHub repository](https://github.com/ysard/cookie-quick-manager/issues).


# How to contribute ?

1. You can contribute by reporting bugs or problems encountered by creating an issue on [this page] (https://github.com/ysard/cookie-quick-manager/issues)


2. You can translate the application into your language.
The files are at this address:
https://github.com/ysard/cookie-quick-manager/tree/fpi/src/_locales

You must fork the repository and then make a pull-request with your changes.
See this documentation with illustrations:

- https://help.github.com/en/articles/fork-a-repo
- https://help.github.com/en/articles/creating-a-pull-request-from-a-fork

Then execute the following commands:

    cd cookie-quick-manager
    make get_missing_from_new_language LOCALE = "from"

(here, `de` is the locale code for Deutch language)

The previous command will create a file in `src/_locales/<your_locale>/messages.json`,
then display the list of elements to be translated.
The file does not need to be translated to 100% to be used!

You must then make your pull request on github.


# License

[GPLv3](https://github.com/ysard/cookie-quick-manager/blob/master/LICENSE").