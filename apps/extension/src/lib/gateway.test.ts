import { describe, expect, it, vi } from 'vitest';
import { cookieDomain, cookieKey, domainMatches, type CookieRecord } from '@cookie-loom/core';
import { createGateway, registerBackground, type BrowserApi } from './gateway';
import { HOST_PERMISSIONS } from './types';
import {
  registerMutationCoordinator,
  withRemoteMutations,
  type MutationRuntime,
} from './mutation-coordinator';

class Event {
  listeners = new Set<(...args: any[]) => any>();
  addListener = (listener: (...args: any[]) => any) => {
    this.listeners.add(listener);
  };
  removeListener = (listener: (...args: any[]) => any) => {
    this.listeners.delete(listener);
  };
  async fire(...args: any[]) {
    await Promise.all([...this.listeners].map((listener) => listener(...args)));
  }
}

function cookie(overrides: Partial<CookieRecord> = {}): CookieRecord {
  return {
    name: 'session',
    value: 'fake-value',
    domain: 'example.com',
    path: '/',
    secure: true,
    httpOnly: true,
    hostOnly: true,
    session: true,
    sameSite: 'lax',
    storeId: '0',
    ...overrides,
  };
}

function fixture(initial: CookieRecord[] = [], firefox = false) {
  let cookies = structuredClone(initial);
  const storage: Record<string, unknown> = {};
  const startup = new Event();
  const changed = new Event();
  let hostAccess = true;
  const canonical = (item: CookieRecord) => {
    const result = { ...item };
    if (firefox) result.firstPartyDomain ??= '';
    return result;
  };
  cookies = cookies.map(canonical);
  const matches = (item: CookieRecord, details: Record<string, unknown>) => {
    if (details.storeId !== undefined && item.storeId !== details.storeId) return false;
    if (details.name !== undefined && item.name !== details.name) return false;
    if (details.domain !== undefined && cookieDomain(item.domain) !== details.domain) return false;
    if (details.path !== undefined && item.path !== details.path) return false;
    if (
      details.firstPartyDomain !== undefined &&
      details.firstPartyDomain !== null &&
      (item.firstPartyDomain ?? '') !== details.firstPartyDomain
    )
      return false;
    const partition = details.partitionKey as CookieRecord['partitionKey'];
    if (!partition && item.partitionKey) return false;
    if (
      partition?.topLevelSite &&
      new URL(item.partitionKey?.topLevelSite ?? 'https://none.invalid').origin !==
        new URL(partition.topLevelSite).origin
    )
      return false;
    if (
      partition?.hasCrossSiteAncestor !== undefined &&
      item.partitionKey?.hasCrossSiteAncestor !== partition.hasCrossSiteAncestor
    )
      return false;
    if (details.url) {
      const url = new URL(details.url as string);
      if (!domainMatches(item, url.hostname) || !url.pathname.startsWith(item.path)) return false;
    }
    return true;
  };
  const select = (details: Record<string, unknown>) =>
    cookies
      .filter((item) => matches(item, details))
      .sort((a, b) => b.path.length - a.path.length)[0];
  const api: BrowserApi = {
    cookies: {
      getAll: vi.fn(async (details) =>
        structuredClone(cookies.filter((item) => matches(item, details))),
      ),
      get: vi.fn(async (details) => structuredClone(select(details) ?? null)),
      getAllCookieStores: vi.fn(async () => [
        { id: firefox ? 'firefox-default' : '0', tabIds: [1] },
      ]),
      set: vi.fn(async (details) => {
        const url = new URL(details.url as string);
        const item = canonical(
          cookie({
            name: details.name as string,
            value: details.value as string,
            domain: (details.domain as string | undefined) ?? url.hostname,
            path: details.path as string,
            secure: details.secure as boolean,
            httpOnly: details.httpOnly as boolean,
            hostOnly: details.domain === undefined,
            session: details.expirationDate === undefined,
            ...(details.expirationDate !== undefined
              ? { expirationDate: details.expirationDate as number }
              : {}),
            sameSite: details.sameSite as CookieRecord['sameSite'],
            storeId: details.storeId as string,
            ...(details.firstPartyDomain !== undefined
              ? { firstPartyDomain: details.firstPartyDomain as string }
              : {}),
            ...(details.partitionKey
              ? { partitionKey: details.partitionKey as CookieRecord['partitionKey'] }
              : {}),
          }),
        );
        cookies = cookies.filter((existing) => cookieKey(existing) !== cookieKey(item));
        cookies.push(item);
        return structuredClone(item);
      }),
      remove: vi.fn(async (details) => {
        const item = select(details);
        if (!item) return null;
        cookies = cookies.filter((existing) => existing !== item);
        return { url: details.url, name: item.name, storeId: item.storeId };
      }),
      onChanged: changed,
    },
    permissions: {
      contains: vi.fn(async (details) => (details.origins ? hostAccess : true)),
      request: vi.fn(async () => true),
      onAdded: new Event(),
      onRemoved: new Event(),
    },
    storage: {
      local: {
        get: vi.fn(async (keys) =>
          typeof keys === 'string' ? { [keys]: storage[keys] } : { ...keys, ...storage },
        ),
        set: vi.fn(async (values) => {
          Object.assign(storage, structuredClone(values));
        }),
      },
      onChanged: new Event(),
    },
    runtime: {
      ...(firefox ? { getBrowserInfo: vi.fn(async () => ({ name: 'Firefox' })) } : {}),
      getURL: (path) => `chrome-extension://test${path}`,
      openOptionsPage: vi.fn(async () => {}),
      onStartup: startup,
    },
    tabs: {
      get: vi.fn(async (id) => ({
        id,
        url: 'https://example.com/account',
        cookieStoreId: firefox ? 'firefox-default' : '0',
      })),
      query: vi.fn(async () => [
        {
          id: 1,
          url: 'https://example.com/account',
          cookieStoreId: firefox ? 'firefox-default' : '0',
        },
      ]),
      create: vi.fn(async () => ({})),
    },
    ...(firefox
      ? {
          contextualIdentities: {
            query: vi.fn(async () => [
              { cookieStoreId: 'firefox-container-1', name: 'Work', colorCode: '#123456' },
            ]),
          },
        }
      : {}),
    scripting: {
      executeScript: vi.fn(async () => [{ frameId: 0, result: { cleared: true } }]),
    },
  };
  return {
    api,
    startup,
    changed,
    storage,
    gateway: createGateway(api),
    cookies: () => cookies,
    denyHostAccess: () => {
      hostAccess = false;
    },
  };
}

function coordinated(f: ReturnType<typeof fixture>) {
  let listener: Parameters<MutationRuntime['onMessage']['addListener']>[0] | undefined;
  const coordinator = registerMutationCoordinator(
    {
      id: 'test',
      getURL: (path) => `chrome-extension://test${path}`,
      onMessage: {
        addListener: (value) => {
          listener = value;
        },
        removeListener: () => {
          listener = undefined;
        },
      },
    },
    f.gateway,
  );
  const client = () =>
    withRemoteMutations(
      f.gateway,
      (message) =>
        new Promise((resolve, reject) => {
          const handled = listener!(
            message,
            {
              id: 'test',
              url: 'chrome-extension://test/workbench.html',
            },
            resolve,
          );
          if (handled !== true)
            reject(new Error('The mutation listener did not claim the channel.'));
        }),
    );
  return { ...coordinator, client };
}

describe('browser gateway', () => {
  it('requests optional host access directly in a user gesture, and no permission during reads', async () => {
    const { api, gateway } = fixture();
    await gateway.getStatus();
    expect(api.permissions.request).not.toHaveBeenCalled();
    const requested = gateway.requestHostAccess();
    expect(api.permissions.request).toHaveBeenCalledWith({ origins: HOST_PERMISSIONS });
    await requested;
  });

  it('blocks cookie access until broad host access has been granted', async () => {
    const f = fixture();
    f.denyHostAccess();
    await expect(f.gateway.listCookies()).rejects.toThrow('Allow website access');
    expect(f.api.cookies.getAll).not.toHaveBeenCalled();
  });

  it('blocks mutations when host access has been revoked after loading cookies', async () => {
    const original = cookie();
    const f = fixture([original]);
    expect(await f.gateway.listCookies()).toEqual([original]);
    f.denyHostAccess();
    await expect(
      f.gateway.saveCookie({ ...original, value: 'new-value' }, original),
    ).rejects.toThrow('Allow website access');
    await expect(f.gateway.deleteCookies([original])).rejects.toThrow('Allow website access');
    expect(f.api.cookies.set).not.toHaveBeenCalled();
    expect(f.api.cookies.remove).not.toHaveBeenCalled();
    expect(f.cookies()).toEqual([original]);
  });

  it('enumerates all partitions, FPI namespaces, and Firefox containers', async () => {
    const f = fixture(
      [
        cookie({ storeId: 'firefox-default' }),
        cookie({ storeId: 'firefox-container-1', firstPartyDomain: 'first.example' }),
      ],
      true,
    );
    expect(await f.gateway.listCookies()).toHaveLength(2);
    expect(f.api.cookies.getAll).toHaveBeenCalledWith({
      storeId: 'firefox-default',
      partitionKey: {},
      firstPartyDomain: null,
    });
    expect(f.api.cookies.getAll).toHaveBeenCalledWith({
      storeId: 'firefox-container-1',
      partitionKey: {},
      firstPartyDomain: null,
    });
    expect(await f.gateway.listStores()).toContainEqual({
      id: 'firefox-container-1',
      name: 'Work',
      incognito: false,
      color: '#123456',
    });
    f.gateway.requestHostAccess();
    expect(f.api.permissions.request).toHaveBeenCalledWith({
      origins: HOST_PERMISSIONS,
    });
  });

  it('preserves partition keys and store IDs when deleting', async () => {
    const partitionKey = { topLevelSite: 'https://first.example', hasCrossSiteAncestor: true };
    const protectedPartition = cookie({
      partitionKey: { topLevelSite: 'https://other.example', hasCrossSiteAncestor: true },
    });
    const target = cookie({ partitionKey });
    const f = fixture([target, protectedPartition]);
    const result = await f.gateway.deleteCookies([target]);
    expect(result.deleted).toEqual([target]);
    expect(f.api.cookies.remove).toHaveBeenCalledWith({
      url: 'https://example.com/',
      name: 'session',
      storeId: '0',
      partitionKey,
    });
    expect(f.cookies()).toEqual([protectedPartition]);
  });

  it('protects exact identities, not other paths, stores or partitions', async () => {
    const protectedCookie = cookie();
    const unprotected = cookie({ path: '/account' });
    const f = fixture([protectedCookie, unprotected]);
    await f.gateway.updatePreferences({ protectedKeys: [cookieKey(protectedCookie)] });
    const result = await f.gateway.deleteCookies([protectedCookie, unprotected]);
    expect(result.protected).toEqual([protectedCookie]);
    expect(result.deleted).toEqual([unprotected]);
    expect(f.cookies()).toEqual([protectedCookie]);
  });

  it('refuses deletion when the browser would select another same-name cookie', async () => {
    const domainCookie = cookie({ domain: '.example.com', hostOnly: false });
    const target = cookie({ domain: 'app.example.com' });
    const f = fixture([domainCookie, target]);
    const result = await f.gateway.deleteCookies([target]);
    expect(result.failed).toHaveLength(1);
    expect(f.api.cookies.remove).not.toHaveBeenCalled();
  });

  it('refuses stale edits and validates values before any browser write', async () => {
    const original = cookie();
    const f = fixture([original]);
    await expect(
      f.gateway.saveCookie({ ...original, value: 'changed' }, { ...original, value: 'stale' }),
    ).rejects.toThrow('changed in the browser');
    await expect(f.gateway.saveCookie({ ...original, path: 'invalid' })).rejects.toThrow(
      'Path must begin',
    );
    expect(f.api.cookies.set).not.toHaveBeenCalled();
  });

  it('rejects collisions including Firefox’s missing versus empty FPI namespace', async () => {
    const original = cookie({ storeId: 'firefox-default' });
    const f = fixture([original], true);
    await expect(f.gateway.saveCookie({ ...original, value: 'overwrite' })).rejects.toThrow(
      'already exists',
    );
    expect(f.api.cookies.set).not.toHaveBeenCalled();
  });

  it('uses browser partition matching when an imported key omits the ancestor bit', async () => {
    const original = cookie({
      partitionKey: { topLevelSite: 'https://first.example', hasCrossSiteAncestor: true },
    });
    const f = fixture([original]);
    await expect(
      f.gateway.saveCookie({
        ...original,
        partitionKey: { topLevelSite: 'https://first.example/' },
      }),
    ).rejects.toThrow('already exists');
    expect(f.api.cookies.set).not.toHaveBeenCalled();
  });

  it('renames safely and moves protection to the saved identity', async () => {
    const original = cookie();
    const f = fixture([original]);
    await f.gateway.updatePreferences({ protectedKeys: [cookieKey(original)] });
    const saved = await f.gateway.saveCookie({ ...original, name: 'renamed' }, original);
    expect(f.cookies()).toEqual([saved]);
    expect((await f.gateway.getPreferences()).protectedKeys).toEqual([cookieKey(saved)]);
    expect(f.api.cookies.set).toHaveBeenCalledWith(
      expect.not.objectContaining({ domain: expect.anything() }),
    );
  });

  it('keeps host-only and domain cookies with the same name separate', async () => {
    const hostCookie = cookie();
    const domainCookie = cookie({ domain: '.example.com', hostOnly: false });
    const f = fixture([hostCookie, domainCookie]);
    expect(await f.gateway.listCookies()).toHaveLength(2);
    await f.gateway.updatePreferences({ protectedKeys: [cookieKey(hostCookie)] });
    const result = await f.gateway.deleteCookies([domainCookie]);
    expect(result.protected).toEqual([]);
    // The API currently selects the host-only cookie first, so refuse the removal.
    expect(result.failed).toHaveLength(1);
    expect(f.api.cookies.remove).not.toHaveBeenCalled();
  });

  it('resolves Firefox writes independently when set returns an older domain sibling', async () => {
    const domain = cookie({ domain: '.example.com', hostOnly: false, storeId: 'firefox-default' });
    const host = cookie({ storeId: 'firefox-default', value: 'host-old' });
    const f = fixture([domain, host], true);
    const nativeSet = vi.mocked(f.api.cookies.set).getMockImplementation()!;
    vi.mocked(f.api.cookies.set).mockImplementation(async (details) => {
      await nativeSet(details);
      return { ...domain, firstPartyDomain: '' };
    });
    const saved = await f.gateway.saveCookie({ ...host, value: 'host-new' }, host);
    expect(saved).toMatchObject({ hostOnly: true, value: 'host-new' });
    expect(f.cookies()).toContainEqual({ ...domain, firstPartyDomain: '' });
    expect(f.api.cookies.remove).not.toHaveBeenCalled();
  });

  it('returns a newly created host cookie instead of the sibling returned by Firefox set', async () => {
    const domain = cookie({ domain: '.example.com', hostOnly: false, storeId: 'firefox-default' });
    const f = fixture([domain], true);
    const nativeSet = vi.mocked(f.api.cookies.set).getMockImplementation()!;
    vi.mocked(f.api.cookies.set).mockImplementation(async (details) => {
      await nativeSet(details);
      return { ...domain, firstPartyDomain: '' };
    });
    const saved = await f.gateway.saveCookie(
      cookie({ storeId: 'firefox-default', value: 'new-host' }),
    );
    expect(saved).toMatchObject({ hostOnly: true, value: 'new-host' });
    expect(f.cookies()).toHaveLength(2);
    expect(f.api.cookies.remove).not.toHaveBeenCalled();
  });

  it('reports an unverifiable write without deleting an unverified cookie', async () => {
    const f = fixture();
    vi.mocked(f.api.cookies.getAll).mockResolvedValue([]);
    await expect(f.gateway.saveCookie(cookie())).rejects.toThrow('write could not be verified');
    expect(f.cookies()).toHaveLength(1);
    expect(f.api.cookies.remove).not.toHaveBeenCalled();
  });

  it('does not accept a null set result for an attribute-only edit', async () => {
    const original = cookie();
    const f = fixture([original]);
    vi.mocked(f.api.cookies.set).mockResolvedValue(null);
    await expect(f.gateway.saveCookie({ ...original, secure: false }, original)).rejects.toThrow(
      'The browser rejected this cookie',
    );
    expect(f.cookies()).toEqual([original]);
    expect(f.api.cookies.remove).not.toHaveBeenCalled();
  });

  it('verifies semantic attributes after set rather than only the unchanged value', async () => {
    const original = cookie();
    const f = fixture([original]);
    vi.mocked(f.api.cookies.set).mockResolvedValue(original);
    await expect(f.gateway.saveCookie({ ...original, httpOnly: false }, original)).rejects.toThrow(
      'write could not be verified',
    );
    expect(f.cookies()).toEqual([original]);
    expect(f.api.cookies.remove).not.toHaveBeenCalled();
  });

  it('rolls back a rename if the original can no longer be removed safely', async () => {
    const original = cookie();
    const f = fixture([original]);
    const originalRemove = vi.mocked(f.api.cookies.remove).getMockImplementation()!;
    vi.mocked(f.api.cookies.remove).mockImplementation(async (details) => {
      if (details.name === 'session') throw new Error('browser failure');
      // fixture removal implementation is retained below for the new cookie.
      return originalRemove(details);
    });
    await expect(f.gateway.saveCookie({ ...original, name: 'renamed' }, original)).rejects.toThrow(
      'rolled back',
    );
    expect(f.cookies()).toEqual([original]);
  });

  it('never exposes browser write errors containing cookie values', async () => {
    const f = fixture();
    vi.mocked(f.api.cookies.set).mockRejectedValue(new Error('Cookie fake-value rejected'));
    await expect(f.gateway.saveCookie(cookie())).rejects.toThrow(
      'The browser rejected this cookie',
    );
    await expect(f.gateway.saveCookie(cookie())).rejects.not.toThrow('fake-value');
  });

  it('retains Firefox FPI and supported ancestor bits, and rejects FPI on Chromium', async () => {
    const f = fixture([], true);
    const saved = await f.gateway.saveCookie(
      cookie({ storeId: 'firefox-container-1', firstPartyDomain: 'first.example' }),
    );
    expect(saved.firstPartyDomain).toBe('first.example');
    expect(f.api.cookies.set).toHaveBeenCalledWith(
      expect.objectContaining({
        firstPartyDomain: 'first.example',
        storeId: 'firefox-container-1',
      }),
    );
    const partitioned = await f.gateway.saveCookie(
      cookie({
        partitionKey: { topLevelSite: 'https://first.example', hasCrossSiteAncestor: true },
      }),
    );
    expect(partitioned.partitionKey?.hasCrossSiteAncestor).toBe(true);
    const chromium = fixture();
    await expect(
      chromium.gateway.saveCookie(cookie({ firstPartyDomain: 'first.example' })),
    ).rejects.toThrow('require Firefox');
  });

  it('rolls back instead of silently discarding a partition ancestor bit', async () => {
    const f = fixture([], true);
    const nativeSet = vi.mocked(f.api.cookies.set).getMockImplementation()!;
    vi.mocked(f.api.cookies.set).mockImplementation(async (details) => {
      const partition = details.partitionKey as CookieRecord['partitionKey'];
      return nativeSet({ ...details, partitionKey: { topLevelSite: partition?.topLevelSite } });
    });
    await expect(
      f.gateway.saveCookie(
        cookie({
          partitionKey: { topLevelSite: 'https://first.example', hasCrossSiteAncestor: true },
        }),
      ),
    ).rejects.toThrow('ancestor bit');
    expect(f.cookies()).toHaveLength(0);
  });

  it('restores an original cookie if a browser loses an edited partition bit', async () => {
    const original = cookie({
      storeId: 'firefox-default',
      partitionKey: { topLevelSite: 'https://first.example' },
    });
    const f = fixture([original], true);
    const nativeSet = vi.mocked(f.api.cookies.set).getMockImplementation()!;
    vi.mocked(f.api.cookies.set).mockImplementation(async (details) => {
      const partition = details.partitionKey as CookieRecord['partitionKey'];
      return nativeSet({ ...details, partitionKey: { topLevelSite: partition?.topLevelSite } });
    });
    await expect(
      f.gateway.saveCookie(
        {
          ...original,
          value: 'changed',
          partitionKey: { topLevelSite: 'https://first.example', hasCrossSiteAncestor: true },
        },
        original,
      ),
    ).rejects.toThrow('ancestor bit');
    expect(f.cookies()[0]?.value).toBe(original.value);
  });

  it('clears only the active main-frame origin after a direct scripting request', async () => {
    const f = fixture();
    const clearing = f.gateway.clearCurrentTabLocalStorage();
    expect(f.api.permissions.request).toHaveBeenCalledWith({ permissions: ['scripting'] });
    await clearing;
    expect(f.api.scripting!.executeScript).toHaveBeenCalledWith({
      target: { tabId: 1 },
      func: expect.any(Function),
      args: ['https://example.com'],
    });
  });

  it('does not inject after a scripting permission denial', async () => {
    const f = fixture();
    vi.mocked(f.api.permissions.request).mockResolvedValue(false);
    await expect(f.gateway.clearCurrentTabLocalStorage()).rejects.toThrow('Scripting access');
    expect(f.api.scripting!.executeScript).not.toHaveBeenCalled();
  });

  it('checks the destination origin again inside the injected main-frame function', async () => {
    const f = fixture();
    const clear = vi.fn();
    await f.gateway.clearCurrentTabLocalStorage();
    const details = vi.mocked(f.api.scripting!.executeScript).mock.calls[0]![0];
    vi.stubGlobal('location', { origin: 'https://navigated.example' });
    vi.stubGlobal('localStorage', { clear });
    try {
      expect(details.func(details.args[0])).toEqual({ cleared: false });
      expect(clear).not.toHaveBeenCalled();
      vi.stubGlobal('location', { origin: 'https://example.com' });
      expect(details.func(details.args[0])).toEqual({ cleared: true });
      expect(clear).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not acknowledge a local-storage SecurityError inside the injected function', async () => {
    const f = fixture();
    await f.gateway.clearCurrentTabLocalStorage();
    const details = vi.mocked(f.api.scripting!.executeScript).mock.calls[0]![0];
    vi.stubGlobal('location', { origin: 'https://example.com' });
    vi.stubGlobal('localStorage', {
      clear: () => {
        throw new DOMException('Storage access denied', 'SecurityError');
      },
    });
    try {
      expect(details.func(details.args[0])).toEqual({ cleared: false });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    ['a resolved Firefox script error', [{ frameId: 0, error: { message: 'Script failed' } }]],
    ['an empty response', []],
    ['a missing acknowledgement', [{ frameId: 0 }]],
    ['a negative acknowledgement', [{ frameId: 0, result: { cleared: false } }]],
    ['an acknowledgement from another frame', [{ frameId: 1, result: { cleared: true } }]],
  ])('does not report local storage cleared for %s', async (_name, results) => {
    const f = fixture();
    vi.mocked(f.api.scripting!.executeScript).mockResolvedValue(results);
    await expect(f.gateway.clearCurrentTabLocalStorage()).rejects.toThrow(
      'local storage could not be cleared',
    );
  });

  it('resolves a Chromium private tab to its actual cookie store', async () => {
    const f = fixture();
    vi.mocked(f.api.tabs.query).mockResolvedValue([
      { id: 12, url: 'https://example.com/', incognito: true },
    ]);
    vi.mocked(f.api.cookies.getAllCookieStores).mockResolvedValue([
      { id: '0', tabIds: [1] },
      { id: '1', tabIds: [12] },
    ]);
    expect(await f.gateway.getCurrentTab()).toEqual({
      id: 12,
      url: 'https://example.com/',
      storeId: '1',
    });
    expect(await f.gateway.listStores()).toContainEqual({
      id: '1',
      name: 'Private browsing',
      incognito: true,
    });
  });

  it('preserves source tab context when opening the workbench and options', async () => {
    const f = fixture();
    await f.gateway.openWorkbench();
    expect(f.api.tabs.create).toHaveBeenCalledWith({
      url: 'chrome-extension://test/workbench.html?sourceTab=1&sourceOrigin=https%3A%2F%2Fexample.com&site=example.com&store=0',
    });
    await f.gateway.openOptions();
    expect(f.api.tabs.create).toHaveBeenCalledWith({
      url: 'chrome-extension://test/options.html?sourceTab=1&sourceOrigin=https%3A%2F%2Fexample.com',
    });
    const workbench = createGateway(f.api, { sourceTabId: 1, useActiveTab: false });
    expect(await workbench.getCurrentTab()).toEqual({
      id: 1,
      url: 'https://example.com/account',
      storeId: '0',
    });
    expect(f.api.tabs.get).toHaveBeenCalledWith(1);
  });

  it('does not guess another website when an explicit source tab was closed or absent', async () => {
    const f = fixture();
    const page = createGateway(f.api, { useActiveTab: false });
    expect(await page.getCurrentTab()).toBeNull();
    const closedSource = createGateway(f.api, { sourceTabId: 42 });
    vi.mocked(f.api.tabs.get).mockRejectedValue(new Error('No tab'));
    expect(await closedSource.getCurrentTab()).toBeNull();
  });

  it('refuses to clear a captured source tab after it navigates to another origin', async () => {
    const f = fixture();
    const page = createGateway(f.api, { sourceTabId: 1, sourceOrigin: 'https://example.com' });
    vi.mocked(f.api.tabs.get).mockResolvedValue({ id: 1, url: 'https://another.example/' });
    await expect(page.clearCurrentTabLocalStorage()).rejects.toThrow('website tab');
    expect(f.api.scripting!.executeScript).not.toHaveBeenCalled();
  });

  it('does not inject anything when the active page is not a website', async () => {
    const f = fixture();
    vi.mocked(f.api.tabs.query).mockResolvedValue([{ id: 1, url: 'about:preferences' }]);
    await expect(f.gateway.clearCurrentTabLocalStorage()).rejects.toThrow('website tab');
    expect(f.api.scripting!.executeScript).not.toHaveBeenCalled();
  });

  it('unsubscribes all change listeners', async () => {
    const f = fixture();
    const listener = vi.fn();
    const unsubscribe = f.gateway.subscribe(listener);
    await f.changed.fire({});
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    await f.changed.fire({});
    expect(listener).toHaveBeenCalledOnce();
  });
});

describe('shared production mutation queue', () => {
  it('rejects the stale second save from concurrent extension pages', async () => {
    const original = cookie();
    const f = fixture([original]);
    const coordinator = coordinated(f);
    const first = coordinator.client(),
      second = coordinator.client();
    const results = await Promise.allSettled([
      first.saveCookie({ ...original, value: 'first-edit' }, original),
      second.saveCookie({ ...original, value: 'second-edit' }, original),
    ]);
    expect(results[0]?.status).toBe('fulfilled');
    expect(results[1]).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({
        message: expect.stringContaining('changed in the browser'),
      }),
    });
    expect(f.cookies()[0]?.value).toBe('first-edit');
    coordinator.dispose();
  });

  it('merges simultaneous theme and protection updates from separate pages', async () => {
    const f = fixture();
    const coordinator = coordinated(f);
    await Promise.all([
      coordinator.client().setProtection([cookie()], true),
      coordinator.client().updatePreferences({ theme: 'dark' }),
    ]);
    expect(await f.gateway.getPreferences()).toMatchObject({
      theme: 'dark',
      protectedKeys: [cookieKey(cookie())],
    });
    coordinator.dispose();
  });

  it('retains two simultaneous protection additions', async () => {
    const f = fixture();
    const coordinator = coordinated(f);
    const first = cookie(),
      second = cookie({ name: 'second' });
    await Promise.all([
      coordinator.client().setProtection([first], true),
      coordinator.client().setProtection([second], true),
    ]);
    expect((await f.gateway.getPreferences()).protectedKeys).toEqual([
      cookieKey(first),
      cookieKey(second),
    ]);
    coordinator.dispose();
  });

  it('queues startup cleanup after already queued protection updates', async () => {
    const original = cookie();
    const f = fixture([original]);
    await f.gateway.updatePreferences({ cleanOnStartup: true });
    const coordinator = coordinated(f);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const updating = coordinator.enqueue(async () => {
      await gate;
      await f.gateway.setProtection([original], true);
    });
    registerBackground(f.api, f.gateway, coordinator.enqueue);
    const starting = f.startup.fire();
    await Promise.resolve();
    expect(f.api.cookies.remove).not.toHaveBeenCalled();
    release();
    await Promise.all([updating, starting]);
    expect(f.cookies()).toEqual([original]);
    coordinator.dispose();
  });
});

describe('background lifecycle', () => {
  it('never cleans on worker initialization and only cleans on browser startup', async () => {
    const f = fixture([cookie()]);
    await f.gateway.updatePreferences({ cleanOnStartup: true });
    registerBackground(f.api);
    expect(f.api.cookies.getAll).not.toHaveBeenCalled();
    expect(f.api.cookies.remove).not.toHaveBeenCalled();
    await f.startup.fire();
    expect(f.cookies()).toHaveLength(0);
    expect(f.storage.lastStartupCleanup).toEqual(
      expect.objectContaining({ deleted: 1, failed: 0 }),
    );
  });

  it('leaves protected cookies in place and defaults startup cleanup off', async () => {
    const original = cookie();
    const f = fixture([original]);
    registerBackground(f.api);
    await f.startup.fire();
    expect(f.api.cookies.remove).not.toHaveBeenCalled();
    await f.gateway.updatePreferences({
      cleanOnStartup: true,
      protectedKeys: [cookieKey(original)],
    });
    await f.startup.fire();
    expect(f.cookies()).toHaveLength(1);
    expect(f.storage.lastStartupCleanup).toEqual(
      expect.objectContaining({ deleted: 0, protected: 1 }),
    );
  });

  it('leaves cookies untouched on startup when previously granted host access is revoked', async () => {
    const original = cookie();
    const f = fixture([original]);
    await f.gateway.updatePreferences({ cleanOnStartup: true });
    f.denyHostAccess();
    registerBackground(f.api);
    await f.startup.fire();
    expect(f.api.cookies.getAll).not.toHaveBeenCalled();
    expect(f.api.cookies.remove).not.toHaveBeenCalled();
    expect(f.cookies()).toEqual([original]);
    expect(f.storage.lastStartupCleanup).toBeUndefined();
  });
});
