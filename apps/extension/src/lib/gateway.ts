import {
  cookieDomain,
  cookieKey,
  cookieUrl,
  validateCookie,
  type CookieRecord,
  type CookieStore,
} from '@cookie-loom/core';
import {
  DEFAULT_PREFERENCES,
  HOST_PERMISSIONS,
  type CurrentTab,
  type DeleteResult,
  type Gateway,
  type Preferences,
} from './types';

type Details = Record<string, unknown>;
type Listener = (...args: any[]) => void;
interface BrowserEvent {
  addListener(listener: Listener): void;
  removeListener(listener: Listener): void;
}

/** Narrow injectable API surface. WXT supplies the production implementation. */
export interface BrowserApi {
  cookies: {
    getAll(details: Details): Promise<CookieRecord[]>;
    get(details: Details): Promise<CookieRecord | null | undefined>;
    getAllCookieStores(): Promise<{ id: string; tabIds: number[]; incognito?: boolean }[]>;
    set(details: Details): Promise<CookieRecord | null | undefined>;
    remove(details: Details): Promise<unknown>;
    onChanged: BrowserEvent;
  };
  permissions: {
    contains(details: { origins?: string[]; permissions?: string[] }): Promise<boolean>;
    request(details: { origins?: string[]; permissions?: string[] }): Promise<boolean>;
    onAdded?: BrowserEvent;
    onRemoved?: BrowserEvent;
  };
  storage: {
    local: { get(keys: string | Details): Promise<Details>; set(values: Details): Promise<void> };
    onChanged: BrowserEvent;
  };
  runtime: {
    getBrowserInfo?: () => Promise<unknown>;
    getURL(path: string): string;
    openOptionsPage(): Promise<void>;
    onStartup: BrowserEvent;
  };
  tabs: {
    get(
      id: number,
    ): Promise<{ id?: number; url?: string; cookieStoreId?: string; incognito?: boolean }>;
    query(
      details: Details,
    ): Promise<{ id?: number; url?: string; cookieStoreId?: string; incognito?: boolean }[]>;
    create(details: { url: string }): Promise<unknown>;
  };
  contextualIdentities?: {
    query(details: Details): Promise<{ cookieStoreId: string; name: string; colorCode?: string }[]>;
  };
  scripting?: {
    executeScript(details: {
      target: { tabId: number };
      func: (origin: string) => { cleared: boolean };
      args: [string];
    }): Promise<unknown>;
  };
}

function normalizeCookie(cookie: CookieRecord): CookieRecord {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    hostOnly: cookie.hostOnly,
    session: cookie.session,
    sameSite: cookie.sameSite ?? 'unspecified',
    storeId: cookie.storeId,
    ...(!cookie.session && cookie.expirationDate !== undefined
      ? { expirationDate: cookie.expirationDate }
      : {}),
    ...(cookie.firstPartyDomain !== undefined ? { firstPartyDomain: cookie.firstPartyDomain } : {}),
    ...(cookie.partitionKey?.topLevelSite ? { partitionKey: { ...cookie.partitionKey } } : {}),
  };
}

function scopeDetails(cookie: CookieRecord, firefox: boolean): Details {
  return {
    url: cookieUrl(cookie),
    name: cookie.name,
    storeId: cookie.storeId,
    ...(firefox ? { firstPartyDomain: cookie.firstPartyDomain ?? '' } : {}),
    ...(cookie.partitionKey?.topLevelSite ? { partitionKey: { ...cookie.partitionKey } } : {}),
  };
}

function setDetails(cookie: CookieRecord, firefox: boolean): Details {
  return {
    ...scopeDetails(cookie, firefox),
    value: cookie.value,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    ...(!cookie.hostOnly ? { domain: cookie.domain } : {}),
    ...(!cookie.session ? { expirationDate: cookie.expirationDate } : {}),
  };
}

function preferencesFrom(value: unknown): Preferences {
  const data = value && typeof value === 'object' ? (value as Partial<Preferences>) : {};
  return {
    theme: ['system', 'light', 'dark'].includes(data.theme ?? '') ? data.theme! : 'system',
    protectedKeys: Array.isArray(data.protectedKeys)
      ? [...new Set(data.protectedKeys.filter((key): key is string => typeof key === 'string'))]
      : [],
    cleanOnStartup: data.cleanOnStartup === true,
  };
}

function equivalent(a: CookieRecord, b: CookieRecord): boolean {
  const left = normalizeCookie(a);
  const right = normalizeCookie(b);
  return (
    cookieKey(left) === cookieKey(right) &&
    left.value === right.value &&
    left.secure === right.secure &&
    left.httpOnly === right.httpOnly &&
    left.session === right.session &&
    left.hostOnly === right.hostOnly &&
    left.sameSite === right.sameSite &&
    left.expirationDate === right.expirationDate
  );
}

function baseIdentity(cookie: CookieRecord): string {
  return cookieKey({
    ...cookie,
    ...(cookie.partitionKey
      ? { partitionKey: { topLevelSite: cookie.partitionKey.topLevelSite } }
      : {}),
  });
}

/** Browser errors sometimes include submitted values, so expose fixed operation messages. */
export class GatewayError extends Error {}
function failure(message: string): GatewayError {
  return new GatewayError(message);
}

export interface GatewayContext {
  /** Captured by the popup, never guessed from another open website tab. */
  sourceTabId?: number;
  sourceOrigin?: string;
  /** Only the popup can safely resolve the active tab as its source. */
  useActiveTab?: boolean;
}

export function createGateway(
  api: BrowserApi,
  context: GatewayContext = { useActiveTab: true },
): Gateway {
  const firefox = typeof api.runtime.getBrowserInfo === 'function';
  let mutationQueue: Promise<unknown> = Promise.resolve();
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = mutationQueue.then(operation, operation);
    mutationQueue = result.catch(() => undefined);
    return result;
  }

  async function readPreferences(): Promise<Preferences> {
    const stored = await api.storage.local.get({ preferences: DEFAULT_PREFERENCES });
    return preferencesFrom(stored.preferences);
  }
  async function persistPreferences(patch: Partial<Preferences>): Promise<Preferences> {
    const preferences = preferencesFrom({ ...(await readPreferences()), ...patch });
    await api.storage.local.set({ preferences });
    return preferences;
  }

  async function requireAccess(): Promise<void> {
    if (!(await api.permissions.contains({ origins: [...HOST_PERMISSIONS] }))) {
      throw failure('Allow website access before managing cookies.');
    }
  }

  function forBrowser(cookie: CookieRecord): CookieRecord {
    const normalized = normalizeCookie(cookie);
    if (firefox) normalized.firstPartyDomain ??= '';
    else delete normalized.firstPartyDomain;
    return normalized;
  }

  async function candidateScope(candidate: CookieRecord): Promise<CookieRecord[]> {
    const cookies = await api.cookies.getAll({
      name: candidate.name,
      domain: cookieDomain(candidate.domain),
      path: candidate.path,
      storeId: candidate.storeId,
      ...(firefox ? { firstPartyDomain: candidate.firstPartyDomain } : {}),
      ...(candidate.partitionKey
        ? { partitionKey: { topLevelSite: candidate.partitionKey.topLevelSite } }
        : {}),
    });
    return cookies
      .map(forBrowser)
      .filter((cookie) => baseIdentity(cookie) === baseIdentity(candidate));
  }

  async function assertSelected(cookie: CookieRecord): Promise<void> {
    const selected = await api.cookies.get(scopeDetails(cookie, firefox));
    if (!selected || cookieKey(forBrowser(selected)) !== cookieKey(forBrowser(cookie))) {
      throw failure(
        'The browser cannot target this cookie unambiguously. Refresh before trying again.',
      );
    }
    if (!equivalent(forBrowser(selected), forBrowser(cookie))) {
      throw failure('This cookie changed in the browser. Refresh before trying again.');
    }
  }

  async function removeExact(cookie: CookieRecord): Promise<void> {
    await assertSelected(cookie);
    const removed = await api.cookies.remove(scopeDetails(cookie, firefox));
    if (!removed) throw failure('The browser did not remove this cookie.');
  }

  const gateway: Gateway = {
    kind: 'browser',
    async getStatus() {
      return {
        hostAccess: await api.permissions.contains({ origins: [...HOST_PERMISSIONS] }),
        canUseContainers:
          firefox &&
          !!api.contextualIdentities &&
          (await api.permissions.contains({ permissions: ['contextualIdentities'] })),
        browser: firefox ? 'firefox' : 'chromium',
      };
    },
    // Keep this call synchronous until permissions.request: browsers require a user gesture.
    requestHostAccess() {
      return api.permissions.request({ origins: [...HOST_PERMISSIONS] });
    },
    async listStores() {
      const stores = await api.cookies.getAllCookieStores();
      const [contexts, tabs] = await Promise.all([
        firefox && api.contextualIdentities
          ? api.contextualIdentities.query({}).catch(() => [])
          : [],
        api.tabs.query({}).catch(() => []),
      ]);
      const result = new Map<string, CookieStore>();
      for (const store of stores) {
        const isPrivate =
          store.incognito === true ||
          store.id === 'firefox-private' ||
          tabs.some(
            (tab) => tab.id !== undefined && store.tabIds.includes(tab.id) && tab.incognito,
          );
        result.set(store.id, {
          id: store.id,
          name: isPrivate ? 'Private browsing' : 'Default',
          incognito: isPrivate,
        });
      }
      for (const context of contexts) {
        result.set(context.cookieStoreId, {
          id: context.cookieStoreId,
          name: context.name,
          incognito: false,
          ...(context.colorCode ? { color: context.colorCode } : {}),
        });
      }
      return [...result.values()];
    },
    async listCookies() {
      await requireAccess();
      const stores = await gateway.listStores();
      // Empty partitionKey enumerates both partitioned and unpartitioned cookies.
      // Firefox additionally needs firstPartyDomain:null to include FPI cookies.
      const groups = await Promise.all(
        stores.map((store) =>
          api.cookies.getAll({
            storeId: store.id,
            partitionKey: {},
            ...(firefox ? { firstPartyDomain: null } : {}),
          }),
        ),
      );
      return [
        ...new Map(
          groups.flat().map((cookie) => {
            const normalized = forBrowser(cookie);
            return [cookieKey(normalized), normalized] as const;
          }),
        ).values(),
      ];
    },
    saveCookie(cookie, original) {
      return serial(async () => {
        await requireAccess();
        const issues = validateCookie(cookie).filter((issue) => issue.severity === 'error');
        if (issues.length) throw failure(issues.map((issue) => issue.message).join(' '));
        if (!firefox && cookie.firstPartyDomain)
          throw failure('First-party isolation cookies require Firefox.');
        if (!firefox && cookie.partitionKey && !cookie.secure) {
          throw failure('Chromium requires Secure for partitioned cookies.');
        }
        const candidate = forBrowser(cookie);
        const originalKey = original && cookieKey(forBrowser(original));
        // Let the browser resolve partition origins and optional ancestor bits before
        // checking collisions; raw imported keys can have a different spelling.
        const before = await candidateScope(candidate);
        const matchesRequestedAncestor = (item: CookieRecord) =>
          candidate.partitionKey?.hasCrossSiteAncestor === undefined ||
          item.partitionKey?.hasCrossSiteAncestor === candidate.partitionKey.hasCrossSiteAncestor;
        const targets = before.filter(matchesRequestedAncestor);
        if (targets.some((target) => cookieKey(target) !== originalKey)) {
          throw failure('A cookie already exists at this name, domain, path, store and partition.');
        }
        if (original) {
          const cookies = await gateway.listCookies();
          const current = cookies.find((item) => cookieKey(item) === originalKey);
          if (!current || !equivalent(current, forBrowser(original)))
            throw failure('This cookie changed in the browser. Refresh before saving.');
          if (!targets.some((target) => cookieKey(target) === originalKey))
            await assertSelected(original);
        }
        try {
          const acknowledged = await api.cookies.set(setDetails(candidate, firefox));
          if (!acknowledged) throw failure('The browser did not save this cookie.');
        } catch {
          throw failure(
            'The browser rejected this cookie. Check its attributes and website access.',
          );
        }
        // Firefox may return an older same-name sibling from cookies.set().
        // Resolve the written identity independently; never use that return value
        // as a deletion or rollback target.
        const after = await candidateScope(candidate);
        const resolved = after.filter(matchesRequestedAncestor);
        if (resolved.length !== 1 && candidate.partitionKey?.hasCrossSiteAncestor !== undefined) {
          const changed = after.filter((item) => {
            const previous = before.find((old) => cookieKey(old) === cookieKey(item));
            return item.value === candidate.value && (!previous || !equivalent(previous, item));
          });
          if (changed.length !== 1) {
            throw failure('The browser write could not be verified. Refresh to review the cookie.');
          }
          const written = changed[0]!;
          const previous = before.find((old) => cookieKey(old) === cookieKey(written));
          try {
            if (previous) {
              await assertSelected(written);
              await api.cookies.set(setDetails(previous, firefox));
              const restored = (await candidateScope(previous)).find(
                (item) => cookieKey(item) === cookieKey(previous),
              );
              if (!restored || !equivalent(restored, previous)) {
                throw failure('The original cookie could not be restored.');
              }
            } else {
              await removeExact(written);
            }
          } catch {
            throw failure(
              'The browser changed the partition identity and rollback failed. Refresh to review the cookie.',
            );
          }
          throw failure(
            'The browser could not preserve the partition ancestor bit. The change was rolled back.',
          );
        }
        const normalized = resolved[0];
        if (
          resolved.length !== 1 ||
          !normalized ||
          normalized.value !== candidate.value ||
          normalized.secure !== candidate.secure ||
          normalized.httpOnly !== candidate.httpOnly ||
          normalized.session !== candidate.session ||
          normalized.sameSite !== candidate.sameSite
        ) {
          throw failure('The browser write could not be verified. Refresh to review the cookie.');
        }
        if (original && cookieKey(normalized) !== originalKey) {
          try {
            await removeExact(original);
          } catch {
            try {
              await removeExact(normalized);
            } catch {
              throw failure(
                'The original cookie was retained, but the new cookie could not be rolled back. Refresh to review both.',
              );
            }
            throw failure(
              'The original cookie could not be safely removed. The new cookie was rolled back.',
            );
          }
          const preferences = await gateway.getPreferences();
          if (preferences.protectedKeys.includes(originalKey!)) {
            await persistPreferences({
              protectedKeys: preferences.protectedKeys.map((key) =>
                key === originalKey ? cookieKey(normalized) : key,
              ),
            });
          }
        }
        return normalized;
      });
    },
    deleteCookies(cookies) {
      return serial(async () => {
        await requireAccess();
        const protectedKeys = new Set((await gateway.getPreferences()).protectedKeys);
        const result: DeleteResult = { deleted: [], protected: [], failed: [] };
        const unique = new Map(cookies.map((cookie) => [cookieKey(cookie), cookie]));
        for (const cookie of unique.values()) {
          if (protectedKeys.has(cookieKey(cookie))) {
            result.protected.push(cookie);
            continue;
          }
          try {
            await removeExact(cookie);
            result.deleted.push(cookie);
          } catch {
            result.failed.push({
              cookie,
              error: 'This cookie changed or could not be safely targeted. Refresh and try again.',
            });
          }
        }
        return result;
      });
    },
    getPreferences: readPreferences,
    updatePreferences(patch) {
      return serial(() => persistPreferences(patch));
    },
    setProtection(cookies, value) {
      return serial(async () => {
        const preferences = await readPreferences();
        const keys = new Set(preferences.protectedKeys);
        for (const cookie of cookies) {
          if (value) keys.add(cookieKey(cookie));
          else keys.delete(cookieKey(cookie));
        }
        return persistPreferences({ protectedKeys: [...keys] });
      });
    },
    subscribe(listener) {
      const changed: Listener = () => listener();
      const events = [
        api.cookies.onChanged,
        api.storage.onChanged,
        api.permissions.onAdded,
        api.permissions.onRemoved,
      ].filter((event): event is BrowserEvent => !!event);
      for (const event of events) event.addListener(changed);
      return () => {
        for (const event of events) event.removeListener(changed);
      };
    },
    async getCurrentTab() {
      const tab =
        context.sourceTabId !== undefined
          ? await api.tabs.get(context.sourceTabId).catch(() => undefined)
          : context.useActiveTab
            ? (await api.tabs.query({ active: true, lastFocusedWindow: true }))[0]
            : undefined;
      if (tab?.id === undefined || !tab.url || !/^https?:\/\//.test(tab.url)) return null;
      if (context.sourceOrigin && new URL(tab.url).origin !== context.sourceOrigin) return null;
      const storeId =
        tab.cookieStoreId ??
        (await api.cookies.getAllCookieStores()).find((store) => store.tabIds.includes(tab.id!))
          ?.id;
      // Chromium does not expose Tab.cookieStoreId. Resolve via the store's tabIds
      // instead of accidentally treating a private tab as the default store.
      if (!storeId) return null;
      return { id: tab.id, url: tab.url, storeId };
    },
    clearCurrentTabLocalStorage() {
      // Start both operations in the click handler, before its user gesture expires.
      const allowed = api.permissions.request({ permissions: ['scripting'] });
      const selected = gateway.getCurrentTab();
      return Promise.all([allowed, selected]).then(async ([granted, tab]) => {
        if (!granted)
          throw failure('Scripting access is required to clear this tab’s local storage.');
        if (!tab || !api.scripting)
          throw failure('Open a website tab before clearing its local storage.');
        try {
          const results = await api.scripting.executeScript({
            target: { tabId: tab.id },
            func: (expectedOrigin: string) => {
              try {
                if (location.origin !== expectedOrigin) return { cleared: false };
                localStorage.clear();
                return { cleared: true };
              } catch {
                return { cleared: false };
              }
            },
            args: [new URL(tab.url).origin],
          });
          // Script failures may resolve rather than reject on either platform.
          // Require an acknowledgement from the one targeted main frame.
          if (
            !Array.isArray(results) ||
            results.length !== 1 ||
            results[0]?.frameId !== 0 ||
            'error' in results[0] ||
            results[0]?.result?.cleared !== true
          ) {
            throw failure('The tab did not confirm that its local storage was cleared.');
          }
        } catch {
          throw failure('The tab navigated or its local storage could not be cleared.');
        }
      });
    },
    async openWorkbench() {
      const tab: CurrentTab | null = await gateway.getCurrentTab();
      const query = tab
        ? `?sourceTab=${tab.id}&sourceOrigin=${encodeURIComponent(new URL(tab.url).origin)}&site=${encodeURIComponent(new URL(tab.url).hostname)}${tab.storeId ? `&store=${encodeURIComponent(tab.storeId)}` : ''}`
        : '';
      await api.tabs.create({ url: `${api.runtime.getURL('/workbench.html')}${query}` });
    },
    async openOptions() {
      const tab = await gateway.getCurrentTab();
      await api.tabs.create({
        url: `${api.runtime.getURL('/options.html')}${tab ? `?sourceTab=${tab.id}&sourceOrigin=${encodeURIComponent(new URL(tab.url).origin)}` : ''}`,
      });
    },
  };
  return gateway;
}

/** Register synchronously. Worker initialization must never trigger cookie cleanup. */
export function registerBackground(
  api: BrowserApi,
  gateway = createGateway(api),
  enqueue: <T>(operation: () => Promise<T>) => Promise<T> = (operation) => operation(),
): () => void {
  const onStartup = () =>
    enqueue(async () => {
      try {
        const preferences = await gateway.getPreferences();
        if (!preferences.cleanOnStartup || !(await gateway.getStatus()).hostAccess) return;
        const result = await gateway.deleteCookies(await gateway.listCookies());
        await api.storage.local.set({
          lastStartupCleanup: {
            at: Date.now(),
            deleted: result.deleted.length,
            protected: result.protected.length,
            failed: result.failed.length,
          },
        });
      } catch {
        // Browser availability can change during startup; never retry on worker wake.
        await api.storage.local
          .set({ lastStartupCleanup: { at: Date.now(), failed: true } })
          .catch(() => undefined);
      }
    });
  api.runtime.onStartup.addListener(onStartup);
  return () => api.runtime.onStartup.removeListener(onStartup);
}
