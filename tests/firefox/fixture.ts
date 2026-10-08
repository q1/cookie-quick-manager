import { cookieKey, type CookieRecord } from '@cookie-loom/core';
import { createGateway, type BrowserApi } from '../../apps/extension/src/lib/gateway';

declare const __FIREFOX_REPORT_URL__: string;
declare const browser: BrowserApi & {
  tabs: BrowserApi['tabs'] & { remove(id: number): Promise<void> };
  runtime: BrowserApi['runtime'] & {
    getBrowserInfo(): Promise<{ name: string; version: string }>;
    reload(): void;
  };
  contextualIdentities: NonNullable<BrowserApi['contextualIdentities']> & {
    create(details: {
      name: string;
      color: string;
      icon: string;
    }): Promise<{ cookieStoreId: string }>;
    remove(id: string): Promise<unknown>;
  };
};

type Check = { name: string; passed: boolean; error?: string };
type State = { phase: 'reload'; checks: Check[]; sentinel: CookieRecord; containerId: string };
const storageKey = 'cookieLoomNativeFirefoxSmoke';
const gateway = createGateway(browser);
const checks: Check[] = [];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function check(name: string, body: () => Promise<void>) {
  try {
    await body();
    checks.push({ name, passed: true });
  } catch (error) {
    checks.push({
      name,
      passed: false,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function rejects(body: () => Promise<unknown>, fragment: string) {
  try {
    await body();
  } catch (error) {
    assert(
      error instanceof Error && error.message.includes(fragment),
      `Expected rejection containing: ${fragment}`,
    );
    return;
  }
  throw new Error('Expected operation to be rejected.');
}

function seed(overrides: Partial<CookieRecord> = {}): CookieRecord {
  return {
    name: 'loom_native',
    value: 'synthetic-value',
    domain: 'app.localhost',
    path: '/',
    secure: true,
    httpOnly: true,
    hostOnly: true,
    session: true,
    sameSite: 'lax',
    storeId: 'firefox-default',
    ...overrides,
  };
}

async function report(success: boolean) {
  await fetch(__FIREFOX_REPORT_URL__, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ success, browser: await browser.runtime.getBrowserInfo(), checks }),
  });
}

void (async () => {
  const savedState = (await browser.storage.local.get(storageKey))[storageKey] as State | undefined;
  if (savedState?.phase === 'reload') {
    checks.push(...savedState.checks);
    await check('production background restart does not run startup cleanup', async () => {
      const current = await gateway.listCookies();
      assert(
        current.some((cookie) => cookieKey(cookie) === cookieKey(savedState.sentinel)),
        'Cookie disappeared when only the extension restarted.',
      );
      assert(
        (await gateway.getPreferences()).cleanOnStartup,
        'Restart-cleanup preference was not persisted.',
      );
    });
    await gateway.updatePreferences({ cleanOnStartup: false, protectedKeys: [] });
    await gateway.deleteCookies(await gateway.listCookies());
    await browser.contextualIdentities.remove(savedState.containerId);
    await report(true);
    return;
  }

  await check('unmodified gateway sees native Firefox permissions and stores', async () => {
    const status = await gateway.getStatus();
    assert(
      status.browser === 'firefox' && status.hostAccess && status.canUseContainers,
      'Native Firefox capability/permission detection failed.',
    );
    assert(
      (await gateway.listStores()).some((store) => store.id === 'firefox-default'),
      'Default Firefox store not found.',
    );
  });
  await check('extension page mutations reach the production background coordinator', async () => {
    const resultKey = 'cookieLoomNativeCoordinatorResult';
    const run = String(Date.now());
    let stop = () => {};
    const completed = new Promise<{ success: boolean; error?: string }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        stop();
        reject(new Error('The extension page did not receive a coordinator response.'));
      }, 15_000);
      const changed = (
        changes: Record<string, { newValue?: { run?: string; success: boolean; error?: string } }>,
        area: string,
      ) => {
        const result = changes[resultKey]?.newValue;
        if (area === 'local' && result?.run === run) {
          stop();
          resolve(result);
        }
      };
      stop = () => {
        clearTimeout(timeout);
        browser.storage.onChanged.removeListener(changed);
      };
      browser.storage.onChanged.addListener(changed);
    });
    const tab = (await browser.tabs.create({
      url: `${browser.runtime.getURL('/workbench.html')}?nativeRun=${run}`,
    })) as { id?: number };
    try {
      const result = await completed;
      assert(result.success, result.error ?? 'Production coordinator request failed.');
    } finally {
      stop();
      if (tab.id !== undefined) await browser.tabs.remove(tab.id);
    }
  });
  let base = await gateway.saveCookie(seed());
  await check('native create and edit retain cookie attributes', async () => {
    assert(
      base.hostOnly && base.httpOnly && base.secure && base.session,
      'Cookie attributes changed on creation.',
    );
    base = await gateway.saveCookie({ ...base, value: 'synthetic-updated' }, base);
    assert(base.value === 'synthetic-updated', 'Edit was not persisted.');
  });
  await check('native duplicate and stale edits are rejected', async () => {
    await rejects(() => gateway.saveCookie({ ...base, value: 'collision' }), 'already exists');
    await rejects(
      () => gateway.saveCookie({ ...base, value: 'new' }, { ...base, value: 'stale' }),
      'changed in the browser',
    );
  });
  await check('native rename removes only its original identity', async () => {
    const originalKey = cookieKey(base);
    base = await gateway.saveCookie({ ...base, name: 'loom_renamed' }, base);
    const rows = await gateway.listCookies();
    assert(
      rows.some((cookie) => cookieKey(cookie) === cookieKey(base)),
      'Renamed cookie missing.',
    );
    assert(
      !rows.some((cookie) => cookieKey(cookie) === originalKey),
      'Original cookie retained after rename.',
    );
  });
  await check('host-only and domain cookies coexist without collapsing', async () => {
    await gateway.saveCookie(seed({ name: 'loom_scope' }));
    await gateway.saveCookie(
      seed({ name: 'loom_scope', domain: '.app.localhost', hostOnly: false }),
    );
    const matches = (await gateway.listCookies()).filter((cookie) => cookie.name === 'loom_scope');
    assert(
      matches.length === 2 && new Set(matches.map(cookieKey)).size === 2,
      'Host-only and domain identities collapsed.',
    );
  });
  await check(
    'editing coexisting host-only and domain cookies preserves both identities',
    async () => {
      const name = 'loom_scope_edit';
      await gateway.saveCookie(seed({ name, domain: '.app.localhost', hostOnly: false }));
      await gateway.saveCookie(seed({ name, value: 'host-original' }));
      const initial = (await gateway.listCookies()).filter((cookie) => cookie.name === name);
      const domain = initial.find((cookie) => !cookie.hostOnly);
      const host = initial.find((cookie) => cookie.hostOnly);
      assert(domain && host, 'Both cookie scopes must exist before the edit.');
      const savedDomain = await gateway.saveCookie({ ...domain, value: 'domain-edited' }, domain);
      assert(
        cookieKey(savedDomain) === cookieKey(domain),
        'Domain edit returned another identity.',
      );
      let savedHost: CookieRecord | undefined;
      let editError: string | undefined;
      try {
        savedHost = await gateway.saveCookie({ ...host, value: 'host-edited' }, host);
      } catch (error) {
        editError = error instanceof Error ? error.message : String(error);
      }
      const current = (await gateway.listCookies()).filter((cookie) => cookie.name === name);
      assert(
        current.length === 2,
        `Editing the host cookie removed its domain sibling. ${editError ?? ''}`,
      );
      assert(!editError, `Host-only edit failed: ${editError}`);
      assert(
        savedHost && cookieKey(savedHost) === cookieKey(host),
        'Host-only edit returned another identity.',
      );
      assert(
        current.find((cookie) => cookieKey(cookie) === cookieKey(host))?.value === 'host-edited' &&
          current.find((cookie) => cookieKey(cookie) === cookieKey(domain))?.value ===
            'domain-edited',
        'Editing one cookie changed its coexisting sibling.',
      );
    },
  );
  await check('native exact-path deletion leaves same-name sibling intact', async () => {
    const root = await gateway.saveCookie(seed({ name: 'loom_path' }));
    const nested = await gateway.saveCookie(seed({ name: 'loom_path', path: '/account' }));
    const result = await gateway.deleteCookies([nested]);
    assert(
      result.deleted.length === 1 && result.failed.length === 0,
      'Nested cookie was not removed.',
    );
    assert(
      (await gateway.listCookies()).some((cookie) => cookieKey(cookie) === cookieKey(root)),
      'Same-name sibling was removed.',
    );
  });
  await check('native Firefox first-party isolation identity survives edits', async () => {
    let isolated = await gateway.saveCookie(
      seed({ name: 'loom_fpi', firstPartyDomain: 'first.localhost' }),
    );
    assert(isolated.firstPartyDomain === 'first.localhost', 'First-party identity changed.');
    isolated = await gateway.saveCookie({ ...isolated, value: 'fpi-edited' }, isolated);
    assert(
      (await gateway.listCookies()).some(
        (cookie) => cookieKey(cookie) === cookieKey(isolated) && cookie.value === 'fpi-edited',
      ),
      'FPI cookie missing from enumeration.',
    );
  });
  await check('native Firefox partition identity survives create, edit and remove', async () => {
    let partitioned = await gateway.saveCookie(
      seed({ name: 'loom_partition', partitionKey: { topLevelSite: 'https://first.localhost' } }),
    );
    assert(
      partitioned.partitionKey?.topLevelSite === 'https://first.localhost',
      'Partition key changed.',
    );
    partitioned = await gateway.saveCookie(
      { ...partitioned, value: 'partition-edited' },
      partitioned,
    );
    assert(
      (await gateway.listCookies()).some((cookie) => cookieKey(cookie) === cookieKey(partitioned)),
      'Partitioned cookie missing from enumeration.',
    );
    const result = await gateway.deleteCookies([partitioned]);
    assert(
      result.deleted.length === 1 && result.failed.length === 0,
      'Partitioned cookie could not be removed.',
    );
  });
  const container = await browser.contextualIdentities.create({
    name: 'Cookie Loom smoke',
    color: 'blue',
    icon: 'briefcase',
  });
  await check('native containers preserve store boundaries and protection', async () => {
    assert(
      (await gateway.listStores()).some(
        (store) => store.id === container.cookieStoreId && store.name === 'Cookie Loom smoke',
      ),
      'New container missing.',
    );
    const copy = await gateway.saveCookie({ ...base, storeId: container.cookieStoreId });
    await gateway.updatePreferences({ protectedKeys: [cookieKey(base)] });
    const result = await gateway.deleteCookies([base, copy]);
    assert(
      result.protected.length === 1 && result.deleted.length === 1 && result.failed.length === 0,
      'Protection crossed a container boundary.',
    );
  });
  await check(
    'native ancestor bits keep same-site and cross-site partitions distinct',
    async () => {
      const sameSite = await gateway.saveCookie(
        seed({
          name: 'loom_ancestor',
          partitionKey: { topLevelSite: 'https://app.localhost', hasCrossSiteAncestor: false },
        }),
      );
      const crossSite = await gateway.saveCookie(
        seed({
          name: 'loom_ancestor',
          partitionKey: { topLevelSite: 'https://app.localhost', hasCrossSiteAncestor: true },
        }),
      );
      assert(
        sameSite.partitionKey?.hasCrossSiteAncestor === false &&
          crossSite.partitionKey?.hasCrossSiteAncestor === true,
        'Ancestor identity was not preserved.',
      );
      assert(
        (await gateway.listCookies()).filter((cookie) => cookie.name === 'loom_ancestor').length ===
          2,
        'Ancestor partitions collapsed.',
      );
    },
  );
  const sentinel = await gateway.saveCookie(seed({ name: 'loom_restart_sentinel' }));
  await gateway.updatePreferences({ cleanOnStartup: true });
  await browser.storage.local.set({
    [storageKey]: {
      phase: 'reload',
      checks,
      sentinel,
      containerId: container.cookieStoreId,
    } satisfies State,
  });
  browser.runtime.reload();
})().catch(async (error) => {
  if (!checks.some((check) => !check.passed))
    checks.push({
      name: 'fixture setup',
      passed: false,
      error: error instanceof Error ? error.message : String(error),
    });
  await report(false);
});
