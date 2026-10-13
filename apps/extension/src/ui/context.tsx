import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { cookieKey, type CookieRecord, type CookieStore } from '@cookie-loom/core';
import type { CurrentTab, Gateway, GatewayStatus, Preferences } from '../lib/types';

interface Workspace {
  gateway: Gateway;
  cookies: CookieRecord[];
  stores: CookieStore[];
  preferences: Preferences;
  status: GatewayStatus | null;
  currentTab: CurrentTab | null;
  loading: boolean;
  refreshing: boolean;
  domains: { domain: string; count: number }[];
  cookieIndex: Map<string, CookieRecord>;
  error: string;
  refresh: () => Promise<void>;
  updatePreferences: (patch: Partial<Preferences>) => Promise<void>;
  protect: (cookies: CookieRecord[], value: boolean) => Promise<void>;
  notify: (message: string) => void;
}

const Context = createContext<Workspace | null>(null);
export function WorkspaceProvider({
  gateway,
  children,
  scope = 'all',
}: {
  gateway: Gateway;
  children: ReactNode;
  scope?: 'all' | 'site';
}) {
  const [cookies, setCookies] = useState<CookieRecord[]>([]);
  const [stores, setStores] = useState<CookieStore[]>([]);
  const [preferences, setPreferences] = useState<Preferences>({
    theme: 'system',
    cleanOnStartup: false,
    protectedKeys: [],
  });
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [currentTab, setCurrentTab] = useState<CurrentTab | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const request = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const refresh = useCallback(async () => {
    clearTimeout(timer.current);
    const id = ++request.current;
    setRefreshing(true);
    try {
      const [nextStatus, nextPreferences, tab, nextStores] = await Promise.all([
        gateway.getStatus(),
        gateway.getPreferences(),
        gateway.getCurrentTab(),
        gateway.listStores(),
      ]);
      const nextCookies =
        nextStatus.hostAccess && (scope === 'all' || tab?.storeId)
          ? await gateway.listCookies({
              storeIds: scope === 'site' ? [tab!.storeId!] : nextStores.map((store) => store.id),
              ...(scope === 'site' ? { host: new URL(tab!.url).hostname } : {}),
            })
          : [];
      if (id !== request.current) return;
      setStatus(nextStatus);
      setPreferences(nextPreferences);
      setCurrentTab(tab);
      setStores(nextStores);
      setCookies(nextCookies);
      setError('');
    } catch (reason) {
      if (id === request.current)
        setError(
          reason instanceof Error ? reason.message : 'Unable to read cookies. Try refreshing.',
        );
    } finally {
      if (id === request.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [gateway, scope]);
  useLayoutEffect(() => {
    void refresh();
    const stop = gateway.subscribe(() => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        void refresh();
      }, 100);
    });
    return () => {
      stop();
      clearTimeout(timer.current);
      request.current++;
    };
  }, [gateway, refresh]);
  useLayoutEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme =
        preferences.theme === 'system' ? (media.matches ? 'dark' : 'light') : preferences.theme;
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [preferences.theme]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(''), 6500);
    return () => clearTimeout(timer);
  }, [message]);
  const updatePreferences = useCallback(
    async (patch: Partial<Preferences>) => {
      setPreferences(await gateway.updatePreferences(patch));
    },
    [gateway],
  );
  const protect = useCallback(
    async (items: CookieRecord[], value: boolean) => {
      setPreferences(await gateway.setProtection(items, value));
    },
    [gateway],
  );
  const cookieIndex = useMemo(
    () => new Map(cookies.map((cookie) => [cookieKey(cookie), cookie])),
    [cookies],
  );
  const domains = useMemo(() => {
    const counts = new Map<string, number>();
    for (const cookie of cookies) {
      const domain = cookie.domain.replace(/^\./, '');
      counts.set(domain, (counts.get(domain) ?? 0) + 1);
    }
    return [...counts]
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => a.domain.localeCompare(b.domain));
  }, [cookies]);
  const value = useMemo(
    () => ({
      gateway,
      cookies,
      stores,
      preferences,
      status,
      currentTab,
      loading,
      refreshing,
      domains,
      cookieIndex,
      error,
      refresh,
      updatePreferences,
      protect,
      notify: setMessage,
    }),
    [
      gateway,
      cookies,
      stores,
      preferences,
      status,
      currentTab,
      loading,
      refreshing,
      domains,
      cookieIndex,
      error,
      refresh,
      updatePreferences,
      protect,
    ],
  );
  return (
    <Context.Provider value={value}>
      {children}
      <div className={`toast ${message ? 'visible' : ''}`} role="status" aria-live="polite">
        {message}
      </div>
    </Context.Provider>
  );
}
export function useWorkspace() {
  const value = useContext(Context);
  if (!value) throw new Error('WorkspaceProvider is required.');
  return value;
}
