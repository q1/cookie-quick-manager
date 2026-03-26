import path from 'node:path';
import process from 'node:process';
import fs from 'node:fs';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '..');
const extensionPath = path.join(workspaceRoot, 'build');
const fixtureUrl = 'http://lvh.me:4173/';
const importFixturePath = path.join(workspaceRoot, 'qa', 'tmp-import-cookie.json');

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

async function getExtensionId(context) {
    let [serviceWorker] = context.serviceWorkers();
    if (!serviceWorker)
        serviceWorker = await context.waitForEvent('serviceworker');

    return serviceWorker.url().split('/')[2];
}

async function waitForCookieValue(page, cookieName, timeoutMs = 3000) {
    const start = Date.now();
    while ((Date.now() - start) < timeoutMs) {
        const cookieValue = await page.evaluate((targetCookieName) => {
            const cookies = document.cookie.split(';').map((entry) => entry.trim()).filter(Boolean);
            for (const entry of cookies) {
                if (entry.startsWith(`${targetCookieName}=`))
                    return entry.split('=').slice(1).join('=');
            }
            return null;
        }, cookieName);

        if (cookieValue !== null)
            return cookieValue;

        await page.waitForTimeout(200);
    }

    return null;
}

async function clickDomainAndCookie(managerPage, domainText, cookieName) {
    const clickedDomain = await managerPage.evaluate((targetDomainText) => {
        const items = [...document.querySelectorAll('#domain-list li')];
        for (const item of items) {
            const label = item.childNodes[0]?.textContent?.trim() || item.textContent.trim();
            if (label === targetDomainText) {
                item.click();
                return true;
            }
        }
        return false;
    }, domainText);
    assert(clickedDomain, `Unable to find domain entry ${domainText}`);

    await managerPage.waitForTimeout(300);

    const clickedCookie = await managerPage.evaluate((targetCookieName) => {
        const items = [...document.querySelectorAll('#cookie-list li')];
        for (const item of items) {
            if (item.textContent.includes(targetCookieName)) {
                item.click();
                return true;
            }
        }
        return false;
    }, cookieName);
    assert(clickedCookie, `Unable to find cookie entry ${cookieName}`);
}

async function run() {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cqm-playwright-'));
    const context = await chromium.launchPersistentContext(userDataDir, {
        headless: true,
        channel: 'chromium',
        ignoreHTTPSErrors: true,
        args: [
            `--disable-extensions-except=${extensionPath}`,
            `--load-extension=${extensionPath}`,
        ],
    });

    const extensionId = await getExtensionId(context);
    const results = [];

    try {
        const fixturePage = await context.newPage();
        await fixturePage.goto(fixtureUrl, {waitUntil: 'domcontentloaded'});

        await fixturePage.getByRole('button', {name: 'Set host-only JS cookie'}).click();
        await fixturePage.getByRole('button', {name: 'Set domain JS cookie (.lvh.me)'}).click();
        await fixturePage.getByRole('button', {name: 'Set fixture localStorage values'}).click();

        const initialCookieString = await fixturePage.evaluate(() => document.cookie);
        assert(initialCookieString.includes('fixture_js_host='), 'Host-only fixture cookie was not created.');
        assert(initialCookieString.includes('fixture_js_domain='), 'Domain fixture cookie was not created.');
        results.push({
            check: 'fixture-seeding',
            status: 'passed',
            details: initialCookieString,
        });

        const managerPage = await context.newPage();
        await managerPage.goto(
            `chrome-extension://${extensionId}/cookies.html?parent_url=${encodeURIComponent(fixtureUrl)}`,
            {waitUntil: 'domcontentloaded'},
        );
        await managerPage.locator('#domain-list li').first().waitFor();

        const domains = await managerPage.locator('#domain-list li').evaluateAll((nodes) => {
            return nodes.map((node) => node.textContent.trim());
        });
        assert(domains.some((text) => text.includes('lvh.me')), 'Fixture domains were not listed in the manager UI.');
        results.push({
            check: 'manager-domain-list',
            status: 'passed',
            details: domains,
        });

        await clickDomainAndCookie(managerPage, 'lvh.me', 'fixture_js_host');
        await managerPage.locator('#auto_actualize_checkbox').click();
        await fixturePage.evaluate(() => {
            document.cookie = 'fixture_auto_refresh=auto-refresh; Path=/';
        });
        await managerPage.waitForTimeout(1000);
        const autoRefreshCookies = await managerPage.locator('#cookie-list li').evaluateAll((nodes) => {
            return nodes.map((node) => node.textContent.trim());
        });
        assert(autoRefreshCookies.some((text) => text.includes('fixture_auto_refresh')), 'Auto-refresh did not pick up a new same-domain cookie.');
        results.push({
            check: 'auto-refresh',
            status: 'passed',
            details: autoRefreshCookies,
        });
        await managerPage.locator('#auto_actualize_checkbox').click();
        await fixturePage.evaluate(() => {
            document.cookie = 'fixture_auto_refresh=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
        });
        await managerPage.waitForTimeout(500);

        await managerPage.locator('#query-subdomains').check();
        await managerPage.locator('#actualize_button').click();
        await managerPage.waitForTimeout(800);
        const groupedDomains = await managerPage.evaluate(() => {
            return [...document.querySelectorAll('#domain-list li')].map((node) => ({
                domain: node.childNodes[0]?.textContent?.trim() || node.textContent.trim(),
                count: node.querySelector('.badge')?.textContent?.trim() || '',
            }));
        });
        assert(groupedDomains.length === 1 && groupedDomains[0].domain === 'lvh.me', `Subdomain grouping produced unexpected domains: ${JSON.stringify(groupedDomains)}`);
        results.push({
            check: 'group-subdomains',
            status: 'passed',
            details: groupedDomains,
        });

        await managerPage.locator('#query-subdomains').uncheck();
        await managerPage.locator('#search_domain').fill('lvh.me :name:"fixture_js_domain"');
        await managerPage.locator('#actualize_button').click();
        await managerPage.waitForTimeout(800);
        const filteredByName = await managerPage.evaluate(() => {
            return {
                domains: [...document.querySelectorAll('#domain-list li')].map((node) => node.childNodes[0]?.textContent?.trim() || node.textContent.trim()),
                cookies: [...document.querySelectorAll('#cookie-list li')].map((node) => node.textContent.trim()),
            };
        });
        assert(filteredByName.cookies.length === 1 && filteredByName.cookies[0].includes('fixture_js_domain'), `Name filter did not isolate the expected cookie: ${JSON.stringify(filteredByName)}`);
        results.push({
            check: 'search-filter-by-name',
            status: 'passed',
            details: filteredByName,
        });

        await managerPage.locator('#search_domain').fill('lvh.me');
        await managerPage.locator('#actualize_button').click();
        await managerPage.waitForTimeout(800);

        await clickDomainAndCookie(managerPage, 'lvh.me', 'fixture_js_host');
        await managerPage.locator('#protect_button').click();

        await fixturePage.bringToFront();
        await fixturePage.getByRole('button', {name: 'Delete host cookie via JS'}).click();

        const restoredValue = await waitForCookieValue(fixturePage, 'fixture_js_host');
        assert(restoredValue !== null, 'Protected host cookie was not restored after page-driven deletion.');
        results.push({
            check: 'protected-cookie-restore',
            status: 'passed',
            details: `restored value=${restoredValue}`,
        });

        await managerPage.bringToFront();
        await clickDomainAndCookie(managerPage, 'lvh.me', 'fixture_js_host');
        await managerPage.locator('#edit_button').click();
        await managerPage.locator('#value').fill('edited-by-qa');
        await managerPage.locator('#save_button').click();

        const editedValue = await waitForCookieValue(fixturePage, 'fixture_js_host');
        assert(editedValue === 'edited-by-qa', `Cookie value was not updated by manager save. Got ${editedValue}`);
        results.push({
            check: 'edit-cookie',
            status: 'passed',
            details: editedValue,
        });

        await clickDomainAndCookie(managerPage, 'lvh.me', 'fixture_js_host');
        await managerPage.locator('.dropup-custom .dropdown-toggle').nth(1).click();
        await managerPage.locator('#clipboard_cookie_export').click();
        await managerPage.locator('#modal_clipboard').waitFor();
        const exportedCookieDump = await managerPage.locator('#clipboard_textarea').inputValue();
        assert(exportedCookieDump.includes('fixture_js_host'), 'Single-cookie export did not include the selected fixture cookie.');
        fs.writeFileSync(importFixturePath, exportedCookieDump, 'utf8');
        await managerPage.locator('#modal_clipboard .btn').last().click();
        results.push({
            check: 'export-cookie-json',
            status: 'passed',
            details: exportedCookieDump.slice(0, 120),
        });

        const directImportAttempt = await managerPage.evaluate(async (jsonDump) => {
            const [jsonCookie] = JSON.parse(jsonDump);
            const params = {
                url: jsonCookie["Host raw"],
                name: jsonCookie["Name raw"],
                value: jsonCookie["Content raw"],
                path: jsonCookie["Path raw"],
                httpOnly: (jsonCookie["HTTP only raw"] === 'true'),
                secure: (jsonCookie["Send for raw"] === 'true'),
                storeId: jsonCookie["Store raw"],
            };

            if (jsonCookie["SameSite raw"] !== undefined)
                params.sameSite = jsonCookie["SameSite raw"];

            if (jsonCookie["Expires raw"] != "0")
                params.expirationDate = parseInt(jsonCookie["Expires raw"], 10);

            try {
                const cookie = await browser.cookies.set(params);
                return {ok: true, params, cookie};
            } catch (error) {
                return {ok: false, params, message: error.message};
            }
        }, exportedCookieDump);
        assert(directImportAttempt.ok, `Direct cookie restore failed with params ${JSON.stringify(directImportAttempt.params)}: ${directImportAttempt.message}`);
        results.push({
            check: 'direct-json-restore',
            status: 'passed',
            details: directImportAttempt.params,
        });

        await clickDomainAndCookie(managerPage, 'lvh.me', 'fixture_js_host');
        await managerPage.locator('#protect_button').click();
        await managerPage.locator('#delete_button').click();
        await fixturePage.waitForTimeout(500);
        const deletedValue = await waitForCookieValue(fixturePage, 'fixture_js_host', 1000);
        assert(deletedValue === null, 'Cookie delete action failed after unprotecting the cookie.');
        results.push({
            check: 'delete-cookie',
            status: 'passed',
            details: 'fixture_js_host deleted',
        });

        await managerPage.locator('.dropup-custom .dropdown-toggle').nth(1).click();
        await managerPage.locator('#file_elem').setInputFiles({
            name: 'fixture-cookie.json',
            mimeType: 'application/json',
            buffer: Buffer.from(exportedCookieDump, 'utf8'),
        });
        const importedValue = await waitForCookieValue(fixturePage, 'fixture_js_host');
        if (importedValue !== 'edited-by-qa') {
            const importInfoText = await managerPage.locator('#info_text').textContent().catch(() => '');
            throw new Error(`Cookie import did not restore exported cookie. Got ${importedValue}. Info text: ${importInfoText}`);
        }
        results.push({
            check: 'import-cookie-json',
            status: 'passed',
            details: importedValue,
        });

        const secureFixturePage = await context.newPage();
        await secureFixturePage.goto('https://lvh.me:4443/', {waitUntil: 'domcontentloaded'});

        const secureManagerPage = await context.newPage();
        await secureManagerPage.goto(
            `chrome-extension://${extensionId}/cookies.html?parent_url=${encodeURIComponent('https://lvh.me:4443/')}`,
            {waitUntil: 'domcontentloaded'},
        );
        await secureManagerPage.locator('#edit_button').click();
        await secureManagerPage.locator('#domain').fill('lvh.me');
        await secureManagerPage.locator('#name').fill('fixture_secure_manual');
        await secureManagerPage.locator('#value').fill('secure-by-qa');
        await secureManagerPage.locator('#path').fill('/');
        await secureManagerPage.locator('#issecure').check();
        await secureManagerPage.locator('#issession').check();
        await secureManagerPage.locator('#samesite').selectOption('no_restriction');
        await secureManagerPage.locator('#save_button').click();

        const secureCookieValue = await waitForCookieValue(secureFixturePage, 'fixture_secure_manual');
        assert(secureCookieValue === 'secure-by-qa', `Secure SameSite=None cookie creation failed. Got ${secureCookieValue}`);
        results.push({
            check: 'create-secure-cookie',
            status: 'passed',
            details: secureCookieValue,
        });

        const optionsPage = await context.newPage();
        await optionsPage.goto(`chrome-extension://${extensionId}/options.html`, {waitUntil: 'domcontentloaded'});
        const fpiVisible = await optionsPage.locator('#fpi_status').isVisible();
        assert(!fpiVisible, 'First-Party Isolation control should be hidden on Chromium.');
        results.push({
            check: 'options-hide-fpi',
            status: 'passed',
            details: 'FPI control hidden on Chromium',
        });

        const initialDeletionAlert = await optionsPage.locator('#display_deletion_alert').isChecked();
        await optionsPage.locator('#display_deletion_alert').setChecked(!initialDeletionAlert);
        await optionsPage.reload({waitUntil: 'domcontentloaded'});
        const persistedDeletionAlert = await optionsPage.locator('#display_deletion_alert').isChecked();
        assert(persistedDeletionAlert === !initialDeletionAlert, 'display_deletion_alert option did not persist after reload.');
        results.push({
            check: 'options-persistence',
            status: 'passed',
            details: {
                initialDeletionAlert,
                persistedDeletionAlert,
            },
        });

        console.log(JSON.stringify({
            ok: true,
            extensionId,
            results,
        }, null, 2));
    } catch (error) {
        console.error(JSON.stringify({
            ok: false,
            error: error.message,
            results,
        }, null, 2));
        process.exitCode = 1;
    } finally {
        fs.rmSync(importFixturePath, {force: true});
        await context.close();
        fs.rmSync(userDataDir, {recursive: true, force: true});
    }
}

run();
