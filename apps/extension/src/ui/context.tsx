import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { type CookieRecord, type CookieStore } from '@cookie-loom/core';
import type { CurrentTab, Gateway, GatewayStatus, Preferences } from '../lib/types';

interface Workspace {
  gateway: Gateway;
  cookies: CookieRecord[];
  stores: CookieStore[];
  preferences: Preferences;
  status: GatewayStatus | null;
  currentTab: CurrentTab | null;
  loading: boolean;
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
}: {
  gateway: Gateway;
  children: ReactNode;
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
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const request = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++request.current;
    try {
      const [nextStatus, nextPreferences, tab, nextStores] = await Promise.all([
        gateway.getStatus(),
        gateway.getPreferences(),
        gateway.getCurrentTab(),
        gateway.listStores(),
      ]);
      const nextCookies = nextStatus.hostAccess ? await gateway.listCookies() : [];
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
      if (id === request.current) setLoading(false);
    }
  }, [gateway]);
  useEffect(() => {
    void refresh();
    let timer: ReturnType<typeof setTimeout>;
    const stop = gateway.subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void refresh();
      }, 100);
    });
    return () => {
      stop();
      clearTimeout(timer);
      request.current++;
    };
  }, [gateway, refresh]);
  useEffect(() => {
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
  const protect = async (items: CookieRecord[], value: boolean) => {
    setPreferences(await gateway.setProtection(items, value));
  };
  return (
    <Context.Provider
      value={{
        gateway,
        cookies,
        stores,
        preferences,
        status,
        currentTab,
        loading,
        error,
        refresh,
        updatePreferences,
        protect,
        notify: setMessage,
      }}
    >
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
