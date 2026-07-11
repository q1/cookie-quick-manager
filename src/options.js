/*
 *  Cookie Quick Manager: An addon to manage (view, search, create, edit,
 *  remove, backup, restore) cookies on Firefox.
 *  Copyright (C) 2017-2019 Ysard
 *
 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 *  Home: https://github.com/ysard/cookie-quick-manager
 */
'use strict';

// IIFE - Immediately Invoked Function Expression
(function(mycode) {

    // The global jQuery object is passed as a parameter
    mycode(window.jQuery, window.vAPI, window, document);

}(function($, vAPI, window, document) {

    // The $ is now locally scoped
    const core = window.CQMCore;
    $(function () {
        /*********** Events attached to UI elements ***********/
        $('#import_protected_cookies').change(function() {
            // Import cookies as protected cookies
            set_option({'import_protected_cookies': $(this).is(':checked')});
        });
        $('#delete_all_on_restart').change(function() {
            // Delete all cookies when the browser restarts
            set_option({'delete_all_on_restart': $(this).is(':checked')});
        });
        $('#fpi_status').change(function() {
            // Set the FPI option
            vAPI.setFirstPartyIsolateStatus($(this).is(':checked'));
        });
        $('#prevent_protected_cookies_deletion').change(function() {
            // Prevent protected cookies deletion from websites
            set_option({'prevent_protected_cookies_deletion': $(this).is(':checked')});
        });
        $('#skin').change(function() {
            // Change skin
            set_option({'skin': $(this).val()});
        });
        $('#open_in_new_tab').change(function() {
            // Delete all cookies when the browser restarts
            set_option({'open_in_new_tab': $(this).is(':checked')});
        });
        $('#display_deletion_alert').change(function() {
            // Display an alert when a user wants to delete all cookies from a context
            set_option({'display_deletion_alert': $(this).is(':checked')});
        });
        $('#template').change(function() {
            // Change template
            set_option({'template': $(this).val()});
        });
        $('#resetUserDataButton').click(async function() {
            // Reset all data
            try {
                await browser.storage.local.clear();
                await browser.storage.local.set(core.getDefaultSettings());
                await get_options();
                build_treeview();
            } catch (error) {
                console.error(error);
            }
        });
        $('#backupUserDataButton').click(function() {
            // Get all storage data
            let get_settings = browser.storage.local.get();
            get_settings.then((items) => {
                // Download the json file
                download({
                    'url': 'data:text/plain,' + encodeURIComponent(JSON.stringify(items, null, 2)),
                    'filename': 'userdata_cookie_quick_manager.json'
                });
            });
        });
        $("#restoreUserDataButton").click(function(event) {
            // Overlay for <input type=file>
            var restoreFilePicker = document.getElementById("restoreFilePicker");
            if (restoreFilePicker) {
                restoreFilePicker.click();
            }
            event.preventDefault(); // prevent navigation to "#"
        });
        $('#restoreFilePicker').change(function(event) {
            // File load onto the browser
            var file = event.target.files[0];
            if (!file)
                return;

            var reader = new FileReader();
            reader.onload = async function(event) {
                try {
                    const restoredSettings = core.sanitizeSettings(JSON.parse(event.target.result));
                    await browser.storage.local.clear();
                    await browser.storage.local.set({...core.getDefaultSettings(), ...restoredSettings});
                    await get_options();
                    build_treeview();
                } catch (error) {
                    window.alert(`Unable to restore settings: ${error.message}`);
                }
            };
            reader.readAsText(file);
        });
        $("#show_delete_all_on_restart").click(function(event) {
            $('#delete_all_on_restart_info').toggle();
        });
        $("#show_fpi").click(function(event) {
            $('#fpi_info').toggle();
        });

        $("#unprotectSelectedCookies").click(async function(event) {
            const cookies = [];
            document.querySelectorAll('#protected-cookie-tree input.protection-entry:checked').forEach((checkbox) => {
                const entry = protectionTreeEntries[Number(checkbox.dataset.entryIndex)];
                cookies.push(typeof entry.record === 'string' ? {
                    domain: entry.domain,
                    name: entry.record,
                    path: '/',
                    storeId: '',
                    hostOnly: !entry.domain.startsWith('.'),
                } : {...entry.record, domain: entry.domain});
            });
            if (!cookies.length)
                return;
            try {
                await vAPI.set_cookie_protection(cookies, false);
                build_treeview();
            } catch (error) {
                console.error(error);
            }

        });

        $('#my-protected-cookies-toggle').click(function(event) {
            // Lazy load of treeview
            build_treeview();
        });

        // Load options from storage and update the interface
        get_options();
        display_features_depending_on_browser_version();
        display_features_depending_on_OS();
        const version = document.getElementById('current-version');
        if (version)
            version.textContent = browser.runtime.getManifest().version;
    });

    /*********** Utils ***********/
    function set_option(option_object) {
        //console.log({set_option: option_object});
        let set_settings = browser.storage.local.set(option_object);
        set_settings.catch((error) => {
            console.log(`set_option_error: ${error}`);
        });
        return set_settings;
    }

    function get_options() {
        // Load options from storage and update the interface
        let get_settings = browser.storage.local.get(core.getDefaultSettings());
        return get_settings.then((items) => {
            items = Object.assign(core.getDefaultSettings(), core.sanitizeSettings(items));
            //console.log({storage_data: items});

            // Update the interface
            $('#delete_all_on_restart').prop('checked', items.delete_all_on_restart);
            $('#import_protected_cookies').prop('checked', items.import_protected_cookies);
            $('#prevent_protected_cookies_deletion').prop('checked', items.prevent_protected_cookies_deletion);
            $('#skin').val(items.skin);
            $('#open_in_new_tab').prop('checked', items.open_in_new_tab);
            $('#display_deletion_alert').prop('checked', items.display_deletion_alert);
            $('#template').val(items.template);
        });
    }

    function display_features_depending_on_browser_version() {
        // Display features according to the capacities of the browser

        // First-Party Isolation
        vAPI.FPI_detection().then(() => {
            if (vAPI.FPI === undefined) {
                // FPI is not available on Chromium.
                $('#fpi_status').closest('.form-group').hide();
            } else {
                // Display FPI status
                $('#fpi_status').prop('checked', vAPI.FPI);
            }
        });
    }

    function display_features_depending_on_OS() {
        // Display features according to the capacities of the OS

        let gettingInfo = browser.runtime.getPlatformInfo();
        gettingInfo.then((info) => {
            // On Android, the addon must be opened in a new tab
            if (info.os == 'android')
                $('#open_in_new_tab').parent().hide();
        })
        .catch((error) => {
            console.log(`display_features_depending_on_OS: ${error}`);
        });
    }

    function download(details) {
        // Download a file that contains the given details
        if ( !details.url ) {
            return;
        }

        var a = document.createElement('a');
        a.href = details.url;
        a.setAttribute('download', details.filename || '');
        a.dispatchEvent(new MouseEvent('click'));
    }


    function build_treeview() {
        // Build a native checkbox tree. Cookie names come from websites and must
        // never be interpreted as HTML inside this privileged extension page.

        let get_settings = browser.storage.local.get(null);
        get_settings.then((items) => {

            const protectedCookies = core.protectedCookiesFromStorage(items);
            const tree = document.getElementById('protected-cookie-tree');
            tree.replaceChildren();
            protectionTreeEntries = [];

            if (!Object.keys(protectedCookies).length) {
                const emptyMessage = document.createElement('i');
                emptyMessage.textContent = browser.i18n.getMessage('oNoProtectedCookiesAlert');
                tree.appendChild(emptyMessage);
                $('#unprotectSelectedCookies').hide();
                return;
            }

            $('#unprotectSelectedCookies').show();
            for (const [domain, records] of Object.entries(protectedCookies)) {
                const fieldset = document.createElement('fieldset');
                const legend = document.createElement('legend');
                const domainLabel = document.createElement('label');
                const selectDomain = document.createElement('input');
                selectDomain.type = 'checkbox';
                const domainText = document.createTextNode(` ${domain} (${records.length})`);
                domainLabel.append(selectDomain, domainText);
                legend.appendChild(domainLabel);
                fieldset.appendChild(legend);

                const entries = [];
                for (const record of records) {
                    const row = document.createElement('div');
                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.className = 'protection-entry';
                    checkbox.dataset.entryIndex = String(protectionTreeEntries.length);
                    const label = document.createElement('label');
                    if (typeof record === 'string') {
                        label.textContent = record;
                    } else {
                        const scopes = [
                            `hostOnly=${record.hostOnly}`,
                            `storeId=${record.storeId || ''}`,
                        ];
                        if (record.firstPartyDomain)
                            scopes.push(`firstPartyDomain=${record.firstPartyDomain}`);
                        if (record.partitionKey?.topLevelSite)
                            scopes.push(`partitionKey=${record.partitionKey.topLevelSite}${
                                typeof record.partitionKey.hasCrossSiteAncestor === 'boolean' ?
                                    `; hasCrossSiteAncestor=${record.partitionKey.hasCrossSiteAncestor}` : ''}`);
                        label.textContent = `${record.name || 'name=""'} — ${record.path} [${scopes.join('; ')}]`;
                    }
                    label.prepend(checkbox, document.createTextNode(' '));
                    row.appendChild(label);
                    fieldset.appendChild(row);
                    entries.push(checkbox);
                    protectionTreeEntries.push({domain, record});
                }
                selectDomain.addEventListener('change', () => {
                    entries.forEach((checkbox) => { checkbox.checked = selectDomain.checked; });
                });
                entries.forEach((checkbox) => checkbox.addEventListener('change', () => {
                    selectDomain.checked = entries.every((entry) => entry.checked);
                    selectDomain.indeterminate = !selectDomain.checked && entries.some((entry) => entry.checked);
                }));
                tree.appendChild(fieldset);
            }

        })
        .catch(err => console.error(err));
    }

    /*********** Global variables ***********/

    var protectionTreeEntries = [];
}));
