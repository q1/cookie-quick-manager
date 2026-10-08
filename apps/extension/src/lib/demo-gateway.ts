import { cookieKey, validateCookie, type CookieRecord, type CookieStore } from '@cookie-loom/core';
import { DEFAULT_PREFERENCES, type Gateway, type Preferences } from './types';

const DEMO_STORES: CookieStore[] = [
  { id: 'demo-default', name: 'Default', incognito: false },
  { id: 'demo-work', name: 'Work', incognito: false, color: '#6c71e8' },
  { id: 'demo-personal', name: 'Personal', incognito: false, color: '#df9951' },
];

/** Synthetic data only. Never read the host page's cookies or storage. */
function demoCookies(): CookieRecord[] {
  const expires = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 120;
  const cookie = (
    domain: string,
    name: string,
    value: string,
    overrides: Partial<CookieRecord> = {},
  ): CookieRecord => ({
    domain,
    name,
    value,
    path: '/',
    secure: true,
    httpOnly: true,
    hostOnly: false,
    session: false,
    expirationDate: expires,
    sameSite: 'lax',
    storeId: 'demo-default',
    ...overrides,
  });
  const session = { session: true, expirationDate: undefined };
  return [
    cookie('.example.com', 'session_id', 'demo-session-a1b2c3d4', session),
    cookie('.example.com', 'preferences', '{"theme":"dark","language":"en"}', { httpOnly: false }),
    cookie('.example.com', 'csrf_token', 'demo-csrf-token', { sameSite: 'strict' }),
    cookie('.example.com', 'consent', 'essential-only', { httpOnly: false }),
    cookie('example.com', '__Host-session', 'demo-app-session', { ...session, hostOnly: true }),
    cookie('.example.com', 'embedded_session', 'demo-partition-session', {
      sameSite: 'no_restriction',
      partitionKey: { topLevelSite: 'https://github.com', hasCrossSiteAncestor: true },
    }),
    cookie('.github.com', 'user_session', 'demo-github-session', {
      ...session,
      storeId: 'demo-work',
    }),
    cookie('.github.com', '_gh_sess', 'demo-encrypted-session', {
      ...session,
      storeId: 'demo-work',
    }),
    cookie('.github.com', 'logged_in', 'yes', { httpOnly: false, storeId: 'demo-work' }),
    cookie('.github.com', 'preferred_color_mode', 'dark', {
      httpOnly: false,
      storeId: 'demo-work',
    }),
    cookie('localhost', 'dev_session', 'local-development-only', {
      ...session,
      hostOnly: true,
      secure: false,
    }),
    cookie('localhost', 'feature_flags', '{"new_dashboard":true}', {
      hostOnly: true,
      secure: false,
      httpOnly: false,
    }),
    cookie('localhost', 'locale', 'en-US', { hostOnly: true, secure: false, httpOnly: false }),
    cookie('.mozilla.org', 'session', 'demo-mozilla-session', {
      ...session,
      storeId: 'demo-personal',
    }),
    cookie('.mozilla.org', 'theme', 'system', { httpOnly: false, storeId: 'demo-personal' }),
  ];
}

export function createDemoGateway(): Gateway {
  let cookies = demoCookies();
  let preferences: Preferences = {
    ...DEFAULT_PREFERENCES,
    protectedKeys: [cookieKey(cookies[0]!), cookieKey(cookies[4]!)],
  };
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };
  const clone = <T>(value: T): T => structuredClone(value);
  return {
    kind: 'demo',
    async getStatus() {
      return { hostAccess: true, canUseContainers: true, browser: 'demo' };
    },
    async requestHostAccess() {
      return true;
    },
    async listStores() {
      return clone(DEMO_STORES);
    },
    async listCookies() {
      return clone(cookies);
    },
    async saveCookie(cookie, original) {
      const errors = validateCookie(cookie).filter((issue) => issue.severity === 'error');
      if (errors.length) throw new Error(errors.map((issue) => issue.message).join(' '));
      const key = cookieKey(cookie);
      const originalKey = original && cookieKey(original);
      if (cookies.some((item) => cookieKey(item) === key && key !== originalKey)) {
        throw new Error('A cookie already exists at this name, domain, path, store and partition.');
      }
      if (originalKey && !cookies.some((item) => cookieKey(item) === originalKey))
        throw new Error('This cookie no longer exists.');
      cookies = cookies.filter((item) => cookieKey(item) !== originalKey);
      cookies.push(clone(cookie));
      if (originalKey && preferences.protectedKeys.includes(originalKey)) {
        preferences.protectedKeys = preferences.protectedKeys.map((protectedKey) =>
          protectedKey === originalKey ? key : protectedKey,
        );
      }
      emit();
      return clone(cookie);
    },
    async deleteCookies(selected) {
      const keys = new Set(selected.map(cookieKey));
      const protectedKeys = new Set(preferences.protectedKeys);
      const removed = cookies.filter(
        (cookie) => keys.has(cookieKey(cookie)) && !protectedKeys.has(cookieKey(cookie)),
      );
      const protectedCookies = cookies.filter(
        (cookie) => keys.has(cookieKey(cookie)) && protectedKeys.has(cookieKey(cookie)),
      );
      cookies = cookies.filter(
        (cookie) => !keys.has(cookieKey(cookie)) || protectedKeys.has(cookieKey(cookie)),
      );
      emit();
      return { deleted: clone(removed), protected: clone(protectedCookies), failed: [] };
    },
    async getPreferences() {
      return clone(preferences);
    },
    async updatePreferences(patch) {
      preferences = { ...preferences, ...clone(patch) };
      emit();
      return clone(preferences);
    },
    async setProtection(items, value) {
      const keys = new Set(preferences.protectedKeys);
      for (const cookie of items) {
        if (value) keys.add(cookieKey(cookie));
        else keys.delete(cookieKey(cookie));
      }
      preferences = { ...preferences, protectedKeys: [...keys] };
      emit();
      return clone(preferences);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async getCurrentTab() {
      return { id: 1, url: 'https://example.com/account', storeId: 'demo-default' };
    },
    async clearCurrentTabLocalStorage() {
      throw new Error('Local storage cleanup is available in the installed extension.');
    },
    async openWorkbench() {
      window.location.assign('/');
    },
    async openOptions() {
      window.location.assign('/?view=settings');
    },
  };
}

export const demoGateway = createDemoGateway();
