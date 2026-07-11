import path from 'node:path';
import process from 'node:process';
import fs from 'node:fs';
import os from 'node:os';
import {spawn, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, '..');
const extensionPath = path.join(workspaceRoot, 'build');
const fixtureUrl = 'http://lvh.me:4173/';
const fixtureHealthUrl = 'http://127.0.0.1:4173/api/request-info';

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

async function getExtensionCookies(extensionPage, details) {
    return extensionPage.evaluate(async (query) => browser.cookies.getAll(query), details);
}

async function waitForExtensionCookie(extensionPage, details, predicate, timeoutMs = 4000) {
    const start = Date.now();
    while ((Date.now() - start) < timeoutMs) {
        const cookies = await getExtensionCookies(extensionPage, details);
        const match = cookies.find(predicate);
        if (match)
            return match;
        await extensionPage.waitForTimeout(100);
    }
    return null;
}

async function fixtureIsReady() {
    try {
        const response = await fetch(fixtureHealthUrl);
        return response.ok;
    } catch (error) {
        return false;
    }
}

async function ensureFixtureServer() {
    if (await fixtureIsReady())
        return null;

    const certPath = path.join(workspaceRoot, 'qa', 'certs', 'fixture-cert.pem');
    const keyPath = path.join(workspaceRoot, 'qa', 'certs', 'fixture-key.pem');
    if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
        const generated = spawnSync('bash', [path.join(workspaceRoot, 'qa', 'generate-dev-cert.sh')], {
            cwd: workspaceRoot,
            stdio: 'inherit',
        });
        if (generated.status !== 0)
            throw new Error('Unable to generate the QA fixture certificate.');
    }

    const child = spawn(process.execPath, [path.join(workspaceRoot, 'qa', 'fixture-server.mjs')], {
        cwd: workspaceRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let diagnostics = '';
    child.stdout.on('data', (chunk) => { diagnostics += chunk; });
    child.stderr.on('data', (chunk) => { diagnostics += chunk; });
    for (let attempt = 0; attempt < 100; attempt++) {
        if (await fixtureIsReady())
            return child;
        if (child.exitCode !== null)
            throw new Error(`Fixture server exited early: ${diagnostics.trim()}`);
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    child.kill('SIGTERM');
    throw new Error(`Fixture server did not become ready: ${diagnostics.trim()}`);
}

async function stopFixtureServer(child) {
    if (!child || child.exitCode !== null)
        return;
    child.kill('SIGTERM');
    await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        new Promise((resolve) => setTimeout(resolve, 2000)),
    ]);
    if (child.exitCode === null)
        child.kill('SIGKILL');
}

async function closeModal(page, selector) {
    const modal = page.locator(selector);
    await modal.waitFor({state: 'visible'});
    await page.evaluate((modalSelector) => {
        window.__cqmModalHidden = new Promise((resolve) => {
            window.jQuery(modalSelector).one('hidden.bs.modal', resolve);
        });
    }, selector);
    await modal.locator('.btn').last().click();
    await page.evaluate(() => window.__cqmModalHidden);
    await modal.waitFor({state: 'hidden'});
}

async function closeModalIfVisible(page, selector) {
    try {
        await page.locator(selector).waitFor({state: 'visible', timeout: 1500});
    } catch (error) {
        return;
    }
    await closeModal(page, selector);
}

async function waitForSelectedProtection(page, expected) {
    await page.waitForFunction(async (isExpected) => {
        const cookie = window.jQuery('#cookie-list li.active').data('cookie');
        if (!cookie)
            return false;
        const protectedCookies = await window.vAPI.get_protected_cookies();
        return window.CQMCore.isCookieProtected(cookie, protectedCookies) === isExpected;
    }, expected);
    await page.locator('#protect_button').waitFor({state: 'visible'});
    await page.waitForFunction(() => !document.querySelector('#protect_button').disabled);
}

async function submitImport(page, file) {
    const marker = `qa-import-pending-${Date.now()}-${Math.random()}`;
    await page.evaluate((value) => {
        document.getElementById('info_text').textContent = value;
    }, marker);
    await page.locator('#file_elem').setInputFiles(file);
    await page.waitForFunction((value) =>
        document.getElementById('info_text').textContent !== value, marker);
    return page.locator('#info_text').textContent();
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
    const results = [];
    let fixtureProcess = null;
    let userDataDir = null;
    let context = null;
    try {
        fixtureProcess = await ensureFixtureServer();
        userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cqm-playwright-'));
        context = await chromium.launchPersistentContext(userDataDir, {
            headless: true,
            channel: 'chromium',
            ignoreHTTPSErrors: true,
            args: [
                `--disable-extensions-except=${extensionPath}`,
                `--load-extension=${extensionPath}`,
                '--host-resolver-rules=MAP lvh.me 127.0.0.1, MAP *.lvh.me 127.0.0.1',
            ],
        });

        const extensionId = await getExtensionId(context);
        const pageErrors = [];
        const runtimeErrors = [];
        const attachServiceWorkerDiagnostics = (worker) => {
            worker.on('console', (message) => {
                if (message.type() === 'error')
                    runtimeErrors.push(`service worker: ${message.text()}`);
            });
        };
        context.serviceWorkers().forEach(attachServiceWorkerDiagnostics);
        context.on('serviceworker', attachServiceWorkerDiagnostics);
        context.on('page', (page) => {
            page.on('pageerror', (error) => pageErrors.push(`${page.url()}: ${error.message}`));
            page.on('console', (message) => {
                if (message.type() === 'error' && page.url().startsWith(`chrome-extension://${extensionId}/`))
                    runtimeErrors.push(`${page.url()}: ${message.text()}`);
            });
        });

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
        await fixturePage.evaluate(() => {
            document.cookie = 'fixture_auto_refresh=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
        });
        await managerPage.waitForFunction(() =>
            ![...document.querySelectorAll('#cookie-list li')].some((node) =>
                node.textContent.includes('fixture_auto_refresh')));
        await managerPage.locator('#auto_actualize_checkbox').click();

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
        await waitForSelectedProtection(managerPage, true);

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
        assert(/1/.test(await managerPage.locator('#modal_clipboard h4.modal-title').textContent()),
            'Clipboard export title omitted its cookie count.');
        await closeModal(managerPage, '#modal_clipboard');
        results.push({
            check: 'export-cookie-json',
            status: 'passed',
            details: exportedCookieDump.slice(0, 120),
        });

        await clickDomainAndCookie(managerPage, 'lvh.me', 'fixture_js_host');
        await managerPage.locator('#protect_button').click();
        await waitForSelectedProtection(managerPage, false);
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
        await submitImport(managerPage, {
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

        await closeModalIfVisible(managerPage, '#modal_info');

        // Domain-scoped cookies were the largest blind spot in the original
        // parity suite. Exercise edit, exact protection, and attribute restore.
        await managerPage.locator('#search_domain').fill('lvh.me');
        await managerPage.locator('#actualize_button').click();
        await managerPage.waitForTimeout(300);
        await clickDomainAndCookie(managerPage, '.lvh.me', 'fixture_js_domain');
        await managerPage.locator('#edit_button').click();
        await managerPage.locator('#value').fill('domain-edited-by-qa');
        await managerPage.locator('#save_button').click();
        const editedDomainCookie = await waitForExtensionCookie(
            managerPage,
            {name: 'fixture_js_domain'},
            (cookie) => cookie.value === 'domain-edited-by-qa',
        );
        assert(editedDomainCookie?.domain === '.lvh.me' && editedDomainCookie.hostOnly === false,
            `Domain-cookie edit lost scope or failed: ${JSON.stringify(editedDomainCookie)}`);
        results.push({
            check: 'edit-domain-cookie',
            status: 'passed',
            details: {domain: editedDomainCookie.domain, hostOnly: editedDomainCookie.hostOnly},
        });

        const protectedDomainCookie = await managerPage.evaluate(async () => browser.cookies.set({
            url: 'https://lvh.me/',
            domain: 'lvh.me',
            name: 'fixture_protected_domain',
            value: 'protected-domain-value',
            path: '/',
            secure: true,
            httpOnly: true,
            sameSite: 'strict',
            expirationDate: Math.floor(Date.now() / 1000) + 3600,
            storeId: '0',
        }));
        assert(protectedDomainCookie, 'Unable to seed protected domain cookie.');
        await managerPage.evaluate(async (cookie) => vAPI.set_cookie_protection([cookie], true), protectedDomainCookie);
        await managerPage.evaluate(async (cookie) => browser.cookies.remove({
            url: 'https://lvh.me/',
            name: cookie.name,
            storeId: cookie.storeId,
        }), protectedDomainCookie);
        const restoredDomainCookie = await waitForExtensionCookie(
            managerPage,
            {name: protectedDomainCookie.name},
            (cookie) => cookie.value === protectedDomainCookie.value,
        );
        assert(restoredDomainCookie, 'Protected domain cookie was not restored.');
        for (const field of ['domain', 'hostOnly', 'path', 'name', 'value', 'secure', 'httpOnly', 'sameSite', 'session', 'storeId'])
            assert(restoredDomainCookie[field] === protectedDomainCookie[field],
                `Protected domain cookie changed ${field}: ${protectedDomainCookie[field]} -> ${restoredDomainCookie[field]}`);
        results.push({
            check: 'protected-domain-attribute-restore',
            status: 'passed',
            details: {
                domain: restoredDomainCookie.domain,
                sameSite: restoredDomainCookie.sameSite,
                httpOnly: restoredDomainCookie.httpOnly,
            },
        });
        await managerPage.evaluate(async (cookie) => {
            await vAPI.set_cookie_protection([cookie], false);
            await browser.cookies.remove({url: 'https://lvh.me/', name: cookie.name, storeId: cookie.storeId});
        }, restoredDomainCookie);

        const rotatingCookie = await managerPage.evaluate(async () => browser.cookies.set({
            url: 'http://lvh.me/',
            name: 'fixture_protected_rotation',
            value: 'old',
            path: '/',
            secure: false,
            httpOnly: false,
            sameSite: 'strict',
            storeId: '0',
        }));
        await managerPage.evaluate(async (cookie) => {
            await vAPI.set_cookie_protection([cookie], true);
            await browser.cookies.remove({url: 'http://lvh.me/', name: cookie.name, storeId: cookie.storeId});
            await browser.cookies.set(CQMCore.buildCookieSetDetails({...cookie, value: 'fresh'}));
        }, rotatingCookie);
        await managerPage.waitForTimeout(400);
        const rotatedCookies = await getExtensionCookies(managerPage, {name: rotatingCookie.name});
        assert(rotatedCookies.length === 1 && rotatedCookies[0].value === 'fresh',
            `Stale protection restore overwrote cookie rotation: ${JSON.stringify(rotatedCookies)}`);
        results.push({check: 'protected-cookie-rotation', status: 'passed', details: 'fresh value retained'});
        await managerPage.evaluate(async (cookie) => {
            await vAPI.set_cookie_protection([cookie], false);
            await browser.cookies.remove({url: 'http://lvh.me/', name: cookie.name, storeId: cookie.storeId});
        }, rotatedCookies[0]);

        const pathCookies = await managerPage.evaluate(async () => Promise.all([
            browser.cookies.set({url: 'http://lvh.me/', name: 'fixture_path_identity', value: 'root', path: '/', storeId: '0'}),
            browser.cookies.set({url: 'http://lvh.me/app', name: 'fixture_path_identity', value: 'app', path: '/app', storeId: '0'}),
        ]));
        const pathDeletionResult = await managerPage.evaluate(async (cookies) => {
            const rootCookie = cookies.find((cookie) => cookie.path === '/');
            await vAPI.set_cookie_protection([rootCookie], true);
            const protectedCount = await vAPI.delete_cookies(Promise.resolve(cookies));
            await new Promise((resolve) => setTimeout(resolve, 250));
            return {
                protectedCount,
                remaining: await browser.cookies.getAll({name: rootCookie.name}),
            };
        }, pathCookies);
        assert(pathDeletionResult.protectedCount === 1 && pathDeletionResult.remaining.length === 1 &&
            pathDeletionResult.remaining[0].path === '/',
            `Exact path protection failed: ${JSON.stringify(pathDeletionResult)}`);
        results.push({
            check: 'exact-path-protection',
            status: 'passed',
            details: {protectedCount: pathDeletionResult.protectedCount, remainingPath: pathDeletionResult.remaining[0].path},
        });
        await managerPage.evaluate(async (cookie) => {
            await vAPI.set_cookie_protection([cookie], false);
            await vAPI.remove_cookie(cookie);
        }, pathDeletionResult.remaining[0]);

        const unprotectedPathCookies = await managerPage.evaluate(async () => Promise.all([
            vAPI.set_cookie({url: 'http://lvh.me/', name: 'fixture_exact_path_delete', value: 'root', path: '/', storeId: '0'}),
            vAPI.set_cookie({url: 'http://lvh.me/', name: 'fixture_exact_path_delete', value: 'app', path: '/app', storeId: '0'}),
            vAPI.set_cookie({url: 'http://lvh.me/', name: 'fixture_exact_path_delete', value: 'odd', path: '/literal?#', storeId: '0'}),
        ]));
        assert(unprotectedPathCookies.every(Boolean),
            `Exact set-result resolution failed for a path sibling: ${JSON.stringify(unprotectedPathCookies)}`);
        await managerPage.evaluate(async (cookie) => vAPI.delete_cookies(Promise.resolve([cookie])),
            unprotectedPathCookies.find((cookie) => cookie.path === '/app'));
        let exactPathSurvivors = await getExtensionCookies(managerPage, {name: 'fixture_exact_path_delete'});
        const oddPathCookie = exactPathSurvivors.find((cookie) => cookie.value === 'odd');
        assert(exactPathSurvivors.length === 2 && exactPathSurvivors.some((cookie) => cookie.path === '/') && oddPathCookie,
        `Deleting /app damaged a same-name path sibling: ${JSON.stringify(exactPathSurvivors)}`);
        await managerPage.evaluate(async (cookie) => vAPI.delete_cookies(Promise.resolve([cookie])), oddPathCookie);
        exactPathSurvivors = await getExtensionCookies(managerPage, {name: 'fixture_exact_path_delete'});
        assert(exactPathSurvivors.length === 1 && exactPathSurvivors[0].path === '/',
            `Deleting an unusual path damaged the root sibling: ${JSON.stringify(exactPathSurvivors)}`);
        await managerPage.evaluate(async (cookies) => vAPI.delete_cookies(Promise.resolve(cookies)), exactPathSurvivors);
        results.push({
            check: 'exact-unprotected-path-deletion',
            status: 'passed',
            details: 'root, /app, and /literal?# remained independently addressable',
        });

        const collisionPage = await context.newPage();
        await collisionPage.goto('http://sub.lvh.me:4173/', {waitUntil: 'domcontentloaded'});
        const collisionCookies = await managerPage.evaluate(async () => {
            const name = 'fixture_host_domain_collision';
            await browser.cookies.set({
                url: 'http://sub.lvh.me/', domain: 'lvh.me', name, value: 'domain', path: '/', storeId: '0',
            });
            await browser.cookies.set({
                url: 'http://sub.lvh.me/', name, value: 'host', path: '/', storeId: '0',
            });
            return browser.cookies.getAll({name, storeId: '0'});
        });
        const collisionHost = collisionCookies.find((cookie) => cookie.hostOnly && cookie.domain === 'sub.lvh.me');
        const collisionDomain = collisionCookies.find((cookie) => !cookie.hostOnly && cookie.domain === '.lvh.me');
        assert(collisionHost && collisionDomain, `Unable to create host/domain collision: ${JSON.stringify(collisionCookies)}`);
        await managerPage.evaluate(async (cookie) => vAPI.set_cookie_protection([cookie], true), collisionHost);
        await collisionPage.evaluate((name) => {
            document.cookie = `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
        }, collisionHost.name);
        const restoredCollisionHost = await waitForExtensionCookie(
            managerPage,
            {name: collisionHost.name, storeId: '0'},
            (cookie) => cookie.hostOnly && cookie.domain === 'sub.lvh.me' && cookie.value === 'host',
        );
        const afterCollisionRestore = await getExtensionCookies(managerPage, {name: collisionHost.name, storeId: '0'});
        assert(restoredCollisionHost && afterCollisionRestore.some((cookie) => cookie.domain === '.lvh.me'),
            `Host restore confused a surviving domain sibling: ${JSON.stringify(afterCollisionRestore)}`);
        await managerPage.evaluate(async (cookie) => {
            await vAPI.set_cookie_protection([cookie], false);
            await vAPI.delete_cookies(Promise.resolve([cookie]));
        }, restoredCollisionHost);
        const afterExactHostDelete = await getExtensionCookies(managerPage, {name: collisionHost.name, storeId: '0'});
        assert(afterExactHostDelete.length === 1 && afterExactHostDelete[0].domain === '.lvh.me',
            `Exact host deletion damaged its domain sibling: ${JSON.stringify(afterExactHostDelete)}`);
        await managerPage.evaluate(async (cookies) => vAPI.delete_cookies(Promise.resolve(cookies)), afterExactHostDelete);
        await collisionPage.close();
        results.push({
            check: 'host-domain-collision-restore-delete',
            status: 'passed',
            details: 'host-only and domain identities stayed independent',
        });

        const specialValue = 'quote-" backslash-\\ token-{EXPIRES} unicode-雪';
        await managerPage.evaluate(async ({value}) => browser.cookies.set({
            url: 'http://lvh.me/',
            domain: 'lvh.me',
            name: 'fixture_json_domain_special',
            value,
            path: '/',
            sameSite: 'lax',
            storeId: '0',
        }), {value: specialValue});
        await managerPage.locator('#actualize_button').click();
        await managerPage.waitForTimeout(300);
        await clickDomainAndCookie(managerPage, '.lvh.me', 'fixture_json_domain_special');

        // Delete in a focused editor must edit text, never delete the cookie.
        await managerPage.locator('#value').focus();
        await managerPage.keyboard.press('Delete');
        assert((await getExtensionCookies(managerPage, {name: 'fixture_json_domain_special'})).length === 1,
            'Delete key in the value editor deleted the selected cookie.');
        results.push({check: 'editor-delete-key-safety', status: 'passed', details: 'cookie retained'});

        await managerPage.evaluate(async () => Promise.all([
            browser.cookies.set({url: 'http://lvh.me/', name: 'fixture_visible_delete_target', value: 'delete', path: '/'}),
            browser.cookies.set({url: 'http://lvh.me/', name: 'fixture_visible_delete_survivor', value: 'keep', path: '/'}),
        ]));
        await managerPage.locator('#search_domain').fill('lvh.me :name:"fixture_visible_delete_target"');
        await managerPage.locator('#actualize_button').click();
        await managerPage.waitForTimeout(300);
        assert((await managerPage.locator('#cookie-list li').count()) === 1,
            'Visible-delete fixture did not isolate one search result.');
        await managerPage.locator('#ask_total_deletion_button').click();
        await managerPage.locator('#modal_alert').waitFor({state: 'visible'});
        await managerPage.locator('#delete_all_button').click();
        await managerPage.waitForTimeout(300);
        assert((await getExtensionCookies(managerPage, {name: 'fixture_visible_delete_target'})).length === 0,
            'Visible target cookie was not deleted.');
        assert((await getExtensionCookies(managerPage, {name: 'fixture_visible_delete_survivor'})).length === 1,
            'Filtered bulk deletion removed a non-visible cookie.');
        results.push({check: 'delete-visible-filtered-only', status: 'passed', details: 'unrelated cookie survived'});
        await managerPage.evaluate(async () => browser.cookies.remove({
            url: 'http://lvh.me/', name: 'fixture_visible_delete_survivor',
        }));
        await managerPage.locator('#search_domain').fill('lvh.me');
        await managerPage.locator('#actualize_button').click();
        await managerPage.waitForTimeout(300);
        await clickDomainAndCookie(managerPage, '.lvh.me', 'fixture_json_domain_special');

        await managerPage.locator('.dropup-custom .dropdown-toggle').nth(1).click();
        await managerPage.locator('#clipboard_cookie_export').click();
        const domainExport = await managerPage.locator('#clipboard_textarea').inputValue();
        const [domainExportRecord] = JSON.parse(domainExport);
        assert(domainExportRecord['Host raw'] === 'http://lvh.me/',
            `Domain export contains malformed URL: ${domainExportRecord['Host raw']}`);
        assert(domainExportRecord['Content raw'] === specialValue,
            'Structured JSON export corrupted special characters or template tokens.');
        await closeModal(managerPage, '#modal_clipboard');
        const specialCookieBeforeImport = (await getExtensionCookies(
            managerPage, {name: 'fixture_json_domain_special'}))[0];
        await managerPage.evaluate(async (cookie) => vAPI.delete_cookies(Promise.resolve([cookie])), specialCookieBeforeImport);
        assert((await getExtensionCookies(managerPage, {name: 'fixture_json_domain_special'})).length === 0,
            'Domain JSON fixture was not removed before import.');
        await submitImport(managerPage, {
            name: 'domain-special.json',
            mimeType: '',
            buffer: Buffer.from(domainExport, 'utf8'),
        });
        const restoredSpecialCookie = await waitForExtensionCookie(
            managerPage,
            {name: 'fixture_json_domain_special'},
            (cookie) => cookie.value === specialValue,
        );
        assert(restoredSpecialCookie?.domain === '.lvh.me' && restoredSpecialCookie.hostOnly === false,
            `Domain JSON round-trip failed: ${JSON.stringify(restoredSpecialCookie)}`);
        results.push({
            check: 'domain-json-roundtrip-special-characters',
            status: 'passed',
            details: {domain: restoredSpecialCookie.domain, value: restoredSpecialCookie.value},
        });
        await closeModalIfVisible(managerPage, '#modal_info');

        const invalidRecord = {...domainExportRecord, 'Name raw': 'fixture_partial_import_must_not_exist'};
        const invalidImportInfo = await submitImport(managerPage, {
            name: 'invalid-partial.json',
            mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify([invalidRecord, null]), 'utf8'),
        });
        assert(invalidImportInfo.length > 0, 'Invalid import did not report an error.');
        assert((await getExtensionCookies(managerPage, {name: invalidRecord['Name raw']})).length === 0,
            'Invalid partial import mutated cookies before full validation.');
        assert(!(await managerPage.locator('#info_text').innerHTML()).includes('<script'),
            'Import error rendering interpreted untrusted markup.');
        results.push({check: 'atomic-import-validation', status: 'passed', details: 'zero partial mutations'});
        await closeModalIfVisible(managerPage, '#modal_info');
        await managerPage.evaluate(async (cookie) => vAPI.delete_cookies(Promise.resolve([cookie])), restoredSpecialCookie);

        const namelessRecord = {
            ...domainExportRecord,
            'Host raw': 'http://lvh.me/',
            'Name raw': '',
            'Content raw': 'nameless-value',
            'Expires raw': '0',
            'This domain only raw': 'true',
        };
        const expiredRecord = {
            ...namelessRecord,
            'Name raw': 'fixture_expired_import_skip',
            'Expires raw': '1',
        };
        const agingImportInfo = await submitImport(managerPage, {
            name: 'aging-backup.json',
            mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify([namelessRecord, expiredRecord]), 'utf8'),
        });
        const namelessCookie = await waitForExtensionCookie(
            managerPage,
            {name: '', domain: 'lvh.me'},
            (cookie) => cookie.hostOnly && cookie.value === 'nameless-value',
        );
        assert(namelessCookie &&
            (await getExtensionCookies(managerPage, {name: 'fixture_expired_import_skip'})).length === 0 &&
            /1\s+cookie/i.test(agingImportInfo) && /expired/i.test(agingImportInfo),
        `Aging backup import mishandled live/expired records: ${JSON.stringify({namelessCookie, agingImportInfo})}`);
        await managerPage.evaluate(async (cookie) => {
            await vAPI.set_cookie_protection([cookie], true);
            const protectedCookies = await vAPI.get_protected_cookies();
            if (!CQMCore.isCookieProtected(cookie, protectedCookies))
                throw new Error('Nameless cookie protection failed.');
            await vAPI.set_cookie_protection([cookie], false);
            await vAPI.delete_cookies(Promise.resolve([cookie]));
        }, namelessCookie);
        await closeModalIfVisible(managerPage, '#modal_info');
        results.push({
            check: 'aging-backup-and-nameless-cookie',
            status: 'passed',
            details: agingImportInfo,
        });

        await managerPage.evaluate(async () => browser.storage.local.set({template: 'NETSCAPE'}));
        await managerPage.reload({waitUntil: 'domcontentloaded'});
        await managerPage.locator('#domain-list li').first().waitFor();
        const netscapeCookies = await managerPage.evaluate(async () => Promise.all([
            vAPI.set_cookie({
                url: 'https://lvh.me/',
                name: 'fixture_netscape_host',
                value: 'host-value',
                path: '/',
                secure: true,
                httpOnly: true,
                expirationDate: Math.floor(Date.now() / 1000) + 3600,
            }),
            vAPI.set_cookie({
                url: 'http://lvh.me/',
                domain: 'lvh.me',
                name: 'fixture_netscape_domain',
                value: 'domain-value',
                path: '/',
                secure: false,
                httpOnly: false,
                expirationDate: Math.floor(Date.now() / 1000) + 3600,
            }),
        ]));
        assert(netscapeCookies.every(Boolean), `Unable to seed Netscape fixtures: ${JSON.stringify(netscapeCookies)}`);
        await managerPage.locator('#search_domain').fill('lvh.me');
        await managerPage.locator('#actualize_button').click();
        await managerPage.waitForTimeout(300);
        await clickDomainAndCookie(managerPage, 'lvh.me', 'fixture_netscape_host');
        await managerPage.locator('.dropup-custom .dropdown-toggle').nth(1).click();
        await managerPage.locator('#clipboard_cookie_export').click();
        await managerPage.locator('#modal_clipboard').waitFor({state: 'visible'});
        const netscapeHostLine = await managerPage.locator('#clipboard_textarea').inputValue();
        await closeModal(managerPage, '#modal_clipboard');
        const hostFields = netscapeHostLine.replace(/^#HttpOnly_/, '').split('\t');
        assert(netscapeHostLine.startsWith('#HttpOnly_lvh.me\t') && hostFields[1] === 'false' && hostFields[3] === 'true',
            `Host-only/HttpOnly Netscape export is nonstandard: ${netscapeHostLine}`);

        await clickDomainAndCookie(managerPage, '.lvh.me', 'fixture_netscape_domain');
        await managerPage.locator('.dropup-custom .dropdown-toggle').nth(1).click();
        await managerPage.locator('#clipboard_cookie_export').click();
        await managerPage.locator('#modal_clipboard').waitFor({state: 'visible'});
        const netscapeDomainLine = await managerPage.locator('#clipboard_textarea').inputValue();
        await closeModal(managerPage, '#modal_clipboard');
        const domainFields = netscapeDomainLine.split('\t');
        assert(domainFields[0] === '.lvh.me' && domainFields[1] === 'true',
            `Domain Netscape export lost include-subdomains semantics: ${netscapeDomainLine}`);
        await managerPage.evaluate(async (cookies) => vAPI.delete_cookies(Promise.resolve(cookies)), netscapeCookies);
        assert((await getExtensionCookies(managerPage, {name: 'fixture_netscape_host'})).length === 0 &&
            (await getExtensionCookies(managerPage, {name: 'fixture_netscape_domain'})).length === 0,
        'Netscape fixtures were not removed before import.');

        const uppercaseNetscape = [netscapeHostLine, netscapeDomainLine].map((line) => {
            const httpOnly = line.startsWith('#HttpOnly_');
            const fields = (httpOnly ? line.slice('#HttpOnly_'.length) : line).split('\t');
            fields[1] = fields[1].toUpperCase();
            fields[3] = fields[3].toUpperCase();
            return `${httpOnly ? '#HttpOnly_' : ''}${fields.join('\t')}`;
        }).join('\n');
        await submitImport(managerPage, {
            name: 'cookies.txt',
            mimeType: 'text/plain',
            buffer: Buffer.from(`\uFEFF# Netscape HTTP Cookie File\n${uppercaseNetscape}`, 'utf8'),
        });
        const restoredNetscapeHost = await waitForExtensionCookie(
            managerPage,
            {name: 'fixture_netscape_host'},
            (cookie) => cookie.hostOnly && cookie.httpOnly && cookie.secure,
        );
        const restoredNetscapeDomain = await waitForExtensionCookie(
            managerPage,
            {name: 'fixture_netscape_domain'},
            (cookie) => !cookie.hostOnly && cookie.domain === '.lvh.me',
        );
        assert(restoredNetscapeHost && restoredNetscapeDomain,
            `Canonical uppercase/BOM Netscape import failed: ${JSON.stringify({restoredNetscapeHost, restoredNetscapeDomain})}`);
        await closeModalIfVisible(managerPage, '#modal_info');
        await managerPage.evaluate(async (cookies) => {
            await vAPI.delete_cookies(Promise.resolve(cookies));
            await browser.storage.local.set({template: 'JSON'});
        }, [restoredNetscapeHost, restoredNetscapeDomain]);
        await managerPage.reload({waitUntil: 'domcontentloaded'});
        await managerPage.locator('#domain-list li').first().waitFor();
        results.push({
            check: 'netscape-standard-roundtrip',
            status: 'passed',
            details: 'host/domain, HttpOnly, Secure, uppercase flags, BOM, and default store',
        });

        const partitionedCookie = await managerPage.evaluate(async () => browser.cookies.set({
            url: 'https://lvh.me/',
            name: 'fixture_partitioned',
            value: 'chips',
            path: '/',
            secure: true,
            sameSite: 'no_restriction',
            storeId: '0',
            partitionKey: {topLevelSite: 'https://example.test'},
        }));
        assert(partitionedCookie?.partitionKey, 'Unable to create partitioned fixture cookie.');
        const partitionedListing = await managerPage.evaluate(async () => vAPI.get_cookies({name: 'fixture_partitioned'}));
        assert(partitionedListing.length === 1 && partitionedListing[0].partitionKey?.topLevelSite,
            `Partitioned cookie is invisible: ${JSON.stringify(partitionedListing)}`);
        await managerPage.locator('#search_domain').fill('lvh.me');
        await managerPage.locator('#query-subdomains').uncheck();
        await managerPage.locator('#actualize_button').click();
        await managerPage.waitForTimeout(300);
        await clickDomainAndCookie(managerPage, 'lvh.me', 'fixture_partitioned');
        assert(await managerPage.locator('#partition-key-row').isVisible() &&
            (await managerPage.locator('#partition-key').inputValue()).startsWith('https://example.test'),
        'Partition scope is not visible in the cookie details UI.');
        await managerPage.locator('#edit_button').click();
        await managerPage.locator('#value').fill('chips-edited');
        await managerPage.locator('#save_button').click();
        const editedPartitionedCookie = await waitForExtensionCookie(
            managerPage,
            {name: 'fixture_partitioned', partitionKey: {}},
            (cookie) => cookie.value === 'chips-edited',
        );
        assert(editedPartitionedCookie?.partitionKey?.topLevelSite === 'https://example.test',
            `Partitioned-cookie edit lost its partition: ${JSON.stringify(editedPartitionedCookie)}`);
        assert((await getExtensionCookies(managerPage, {name: 'fixture_partitioned'})).length === 0,
            'Partitioned-cookie edit created an unpartitioned duplicate.');

        await managerPage.locator('.dropup-custom .dropdown-toggle').nth(1).click();
        await managerPage.locator('#clipboard_cookie_export').click();
        const partitionedExport = await managerPage.locator('#clipboard_textarea').inputValue();
        const [partitionedExportRecord] = JSON.parse(partitionedExport);
        assert(partitionedExportRecord['Partition key']?.topLevelSite === 'https://example.test',
            `Single-cookie export lost partition identity: ${partitionedExport}`);
        await closeModal(managerPage, '#modal_clipboard');
        await managerPage.evaluate(async (cookies) => vAPI.delete_cookies(Promise.resolve(cookies)), [editedPartitionedCookie]);
        assert((await managerPage.evaluate(async () =>
            browser.cookies.getAll({name: 'fixture_partitioned', partitionKey: {}}))).length === 0,
        'Partitioned fixture was not removed before import.');
        await submitImport(managerPage, {
            name: 'partitioned-cookie.json',
            mimeType: 'application/json',
            buffer: Buffer.from(partitionedExport, 'utf8'),
        });
        const restoredPartitionedCookie = await waitForExtensionCookie(
            managerPage,
            {name: 'fixture_partitioned', partitionKey: {}},
            (cookie) => cookie.value === 'chips-edited',
        );
        assert(restoredPartitionedCookie?.partitionKey?.topLevelSite === 'https://example.test',
            `Partitioned-cookie import lost scope: ${JSON.stringify(restoredPartitionedCookie)}`);
        await closeModalIfVisible(managerPage, '#modal_info');
        await managerPage.evaluate(async (cookies) => vAPI.delete_cookies(Promise.resolve(cookies)), [restoredPartitionedCookie]);
        const partitionedAfterDelete = await managerPage.evaluate(async () =>
            browser.cookies.getAll({name: 'fixture_partitioned', partitionKey: {}}));
        assert(partitionedAfterDelete.length === 0, 'Partitioned cookie deletion failed.');
        results.push({
            check: 'partitioned-cookie-edit-export-import-delete',
            status: 'passed',
            details: partitionedCookie.partitionKey,
        });

        await managerPage.evaluate(async () => Promise.all([
            browser.cookies.set({
                url: 'https://lvh.me/', name: 'fixture_partition_visual', value: 'one', path: '/', secure: true,
                sameSite: 'no_restriction', storeId: '0',
                partitionKey: {topLevelSite: 'https://lvh.me', hasCrossSiteAncestor: false},
            }),
            browser.cookies.set({
                url: 'https://lvh.me/', name: 'fixture_partition_visual', value: 'two', path: '/', secure: true,
                sameSite: 'no_restriction', storeId: '0',
                partitionKey: {topLevelSite: 'https://lvh.me', hasCrossSiteAncestor: true},
            }),
        ]));
        const partitionVisualCookies = await managerPage.evaluate(async () =>
            vAPI.get_cookies({name: 'fixture_partition_visual'}));
        assert(partitionVisualCookies.length === 2,
            `Unable to create two partition-identity fixtures: ${JSON.stringify(partitionVisualCookies)}`);
        await managerPage.locator('#search_domain').fill('lvh.me');
        await managerPage.locator('#query-subdomains').uncheck();
        await managerPage.locator('#actualize_button').click();
        await managerPage.waitForTimeout(300);
        await clickDomainAndCookie(managerPage, 'lvh.me', 'fixture_partition_visual');
        const partitionLabels = await managerPage.locator('#cookie-list li').evaluateAll((nodes) => nodes
            .filter((node) => node.textContent.includes('fixture_partition_visual'))
            .map((node) => node.querySelector('.partition-badge')?.textContent));
        assert(partitionLabels.length === 2 && partitionLabels.some((label) => label.includes('hasCrossSiteAncestor=false')) &&
            partitionLabels.some((label) => label.includes('hasCrossSiteAncestor=true')),
        `Partitioned cookie rows are visually ambiguous: ${JSON.stringify(partitionLabels)}`);
        await managerPage.evaluate(async () => {
            const cookies = await vAPI.get_cookies({name: 'fixture_partition_visual'});
            await vAPI.delete_cookies(Promise.resolve(cookies));
        });
        results.push({check: 'partition-scope-visible', status: 'passed', details: partitionLabels});

        const subdomainPage = await context.newPage();
        await subdomainPage.goto('http://sub.lvh.me:4173/', {waitUntil: 'domcontentloaded'});
        await subdomainPage.getByRole('button', {name: 'Set host-only JS cookie'}).click();
        await managerPage.locator('#search_domain').fill('lvh.me');
        await managerPage.locator('#query-subdomains').check();
        await managerPage.locator('#actualize_button').click();
        await managerPage.waitForTimeout(350);
        const actualSubdomainGrouping = await managerPage.evaluate(() =>
            [...document.querySelectorAll('#domain-list li')].map((node) =>
                node.childNodes[0]?.textContent?.trim() || node.textContent.trim()));
        assert(actualSubdomainGrouping.length === 1 && actualSubdomainGrouping[0] === 'lvh.me',
            `Actual subdomain cookie was not grouped at a label boundary: ${JSON.stringify(actualSubdomainGrouping)}`);
        results.push({check: 'actual-subdomain-grouping', status: 'passed', details: actualSubdomainGrouping});

        const siteManagerPage = await context.newPage();
        await siteManagerPage.goto(
            `chrome-extension://${extensionId}/cookies.html?parent_url=${encodeURIComponent('http://sub.lvh.me:4173/')}`,
            {waitUntil: 'domcontentloaded'},
        );
        await siteManagerPage.locator('#domain-list li').first().waitFor();
        const siteSpecificDomains = await siteManagerPage.evaluate(() =>
            [...document.querySelectorAll('#domain-list li')].map((node) =>
                node.childNodes[0]?.textContent?.trim() || node.textContent.trim()));
        assert(siteSpecificDomains.includes('sub.lvh.me') && siteSpecificDomains.includes('.lvh.me') &&
            !siteSpecificDomains.includes('lvh.me'),
        `Site-specific launch omitted applicable parent cookies or included host-only parents: ${JSON.stringify(siteSpecificDomains)}`);
        results.push({check: 'site-specific-parent-domain-filter', status: 'passed', details: siteSpecificDomains});
        await siteManagerPage.close();
        await subdomainPage.close();

        await managerPage.evaluate(async () => Promise.all([
            browser.cookies.set({url: 'http://example.com/', name: 'fixture_domain_boundary', value: 'parent', path: '/'}),
            browser.cookies.set({url: 'http://notexample.com/', name: 'fixture_domain_boundary', value: 'other', path: '/'}),
        ]));
        await managerPage.locator('#search_domain').fill('example.com');
        await managerPage.locator('#actualize_button').click();
        await managerPage.waitForTimeout(350);
        const boundaryDomains = await managerPage.evaluate(() =>
            [...document.querySelectorAll('#domain-list li')].map((node) =>
                node.childNodes[0]?.textContent?.trim() || node.textContent.trim()));
        assert(boundaryDomains.includes('example.com') && boundaryDomains.includes('notexample.com'),
            `Domain grouping merged substring-only hosts: ${JSON.stringify(boundaryDomains)}`);
        results.push({check: 'domain-boundary-grouping', status: 'passed', details: boundaryDomains});
        await managerPage.evaluate(async () => Promise.all([
            browser.cookies.remove({url: 'http://example.com/', name: 'fixture_domain_boundary'}),
            browser.cookies.remove({url: 'http://notexample.com/', name: 'fixture_domain_boundary'}),
        ]));

        const prototypeCookie = await managerPage.evaluate(async () => browser.cookies.set({
            url: 'http://constructor/', name: 'fixture_prototype_domain', value: 'visible', path: '/',
        }));
        assert(prototypeCookie, 'Unable to seed prototype-named intranet domain.');
        await managerPage.locator('#query-subdomains').uncheck();
        await managerPage.locator('#search_domain').fill('constructor');
        await managerPage.locator('#actualize_button').click();
        await managerPage.waitForTimeout(350);
        assert(await managerPage.locator('#cookie-list').getByText(/fixture_prototype_domain/).isVisible(),
            'Prototype-named domain disappeared from manager data structures.');
        results.push({check: 'prototype-domain-safety', status: 'passed', details: prototypeCookie.domain});
        await managerPage.evaluate(async () => browser.cookies.remove({
            url: 'http://constructor/', name: 'fixture_prototype_domain',
        }));

        await fixturePage.bringToFront();
        const localStorageBefore = await fixturePage.evaluate(() => window.localStorage.length);
        assert(localStorageBefore === 2, `Expected two fixture LocalStorage values, got ${localStorageBefore}.`);
        const menuPage = await context.newPage();
        const menuNavigation = menuPage.goto(`chrome-extension://${extensionId}/menu.html`, {waitUntil: 'domcontentloaded'});
        await fixturePage.bringToFront();
        await menuNavigation;
        await menuPage.waitForFunction(() => document.querySelector('#delete_current_localstorage').textContent.includes('(2)'));
        const popupCounts = {
            site: await menuPage.locator('#delete_current_cookies').textContent(),
            store: await menuPage.locator('#delete_context_cookies').textContent(),
            localStorage: await menuPage.locator('#delete_current_localstorage').textContent(),
        };
        assert(/\(\d+\)/.test(popupCounts.site) && /\(\d+\)/.test(popupCounts.store),
            `Popup cookie counts did not render: ${JSON.stringify(popupCounts)}`);
        await menuPage.locator('#delete_current_localstorage').click();
        await fixturePage.waitForFunction(() => window.localStorage.length === 0);
        assert((await fixturePage.evaluate(() => window.localStorage.length)) === 0,
            'Popup LocalStorage clear failed.');
        if (!menuPage.isClosed())
            await menuPage.close();
        results.push({check: 'popup-counts-localstorage-clear', status: 'passed', details: popupCounts});

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
        assert((await optionsPage.locator('#current-version').textContent()) === '0.6.0',
            'Options About page does not show the manifest release version.');
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

        await optionsPage.evaluate(async () => browser.storage.local.set({
            protected_cookies: {
                'example.test': ['<b id="fixture-settings-injection">unsafe markup</b>'],
            },
            skin: 'javascript:alert(1)',
        }));
        await optionsPage.locator('#my-protected-cookies-toggle').click();
        await optionsPage.locator('#protected-cookie-tree label').waitFor();
        assert((await optionsPage.locator('#fixture-settings-injection').count()) === 0,
            'Protected-cookie settings were interpreted as privileged HTML.');
        assert((await optionsPage.locator('#protected-cookie-tree').textContent()).includes('<b id="fixture-settings-injection">'),
            'Protected-cookie name was not rendered literally.');
        results.push({check: 'settings-html-injection-safety', status: 'passed', details: 'markup rendered as text'});

        await optionsPage.evaluate(async () => {
            const staleCookie = {
                domain: 'stale.example', hostOnly: true, path: '/', name: 'stale', storeId: '0',
            };
            await browser.storage.local.set({
                [CQMCore.protectionStorageKey(staleCookie)]: {
                    domain: staleCookie.domain,
                    record: CQMCore.makeProtectionRecord(staleCookie),
                },
            });
        });
        await optionsPage.locator('#restoreFilePicker').setInputFiles({
            name: 'settings-backup.json',
            mimeType: 'application/json',
            buffer: Buffer.from(JSON.stringify({display_deletion_alert: false, template: 'NETSCAPE'}), 'utf8'),
        });
        await optionsPage.waitForFunction(async () => {
            const values = await browser.storage.local.get(null);
            return values.display_deletion_alert === false && values.template === 'NETSCAPE' &&
                !Object.keys(values).some((key) => key.startsWith('protected_cookie:'));
        });
        results.push({
            check: 'settings-restore-replaces-snapshot',
            status: 'passed',
            details: 'stale exact protection removed',
        });

        await optionsPage.locator('a[href="#settings"]').click();
        await optionsPage.locator('#resetUserDataButton').click();
        await optionsPage.waitForFunction(async () => {
            const values = await browser.storage.local.get(null);
            return values.display_deletion_alert === true &&
                values.prevent_protected_cookies_deletion === true &&
                values.template === 'JSON';
        });
        const resetSettings = await optionsPage.evaluate(async () => browser.storage.local.get(null));
        assert(!Object.keys(resetSettings).some((key) => key.startsWith('protected_cookie:')),
            'Settings reset left exact protection records behind.');
        results.push({
            check: 'settings-reset-defaults',
            status: 'passed',
            details: {
                display_deletion_alert: resetSettings.display_deletion_alert,
                prevent_protected_cookies_deletion: resetSettings.prevent_protected_cookies_deletion,
                template: resetSettings.template,
            },
        });

        assert(pageErrors.length === 0, `Unexpected extension/page errors: ${JSON.stringify(pageErrors)}`);
        assert(runtimeErrors.length === 0, `Unexpected extension runtime errors: ${JSON.stringify(runtimeErrors)}`);

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
        if (context)
            await context.close();
        if (userDataDir)
            fs.rmSync(userDataDir, {recursive: true, force: true});
        await stopFixtureServer(fixtureProcess);
    }
}

run();
