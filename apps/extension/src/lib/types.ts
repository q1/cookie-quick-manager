import type { CookieRecord, CookieStore } from '@cookie-loom/core';

export interface Preferences {
  theme: 'system' | 'light' | 'dark';
  protectedKeys: string[];
  cleanOnStartup: boolean;
}

export interface GatewayStatus {
  hostAccess: boolean;
  canUseContainers: boolean;
  browser: 'firefox' | 'chromium' | 'demo';
}

export interface CurrentTab {
  id: number;
  url: string;
  storeId?: string;
}

export interface DeleteResult {
  deleted: CookieRecord[];
  protected: CookieRecord[];
  failed: { cookie: CookieRecord; error: string }[];
}

export interface Gateway {
  readonly kind: 'browser' | 'demo';
  getStatus(): Promise<GatewayStatus>;
  requestHostAccess(): Promise<boolean>;
  listStores(): Promise<CookieStore[]>;
  listCookies(): Promise<CookieRecord[]>;
  saveCookie(cookie: CookieRecord, original?: CookieRecord): Promise<CookieRecord>;
  deleteCookies(cookies: CookieRecord[]): Promise<DeleteResult>;
  getPreferences(): Promise<Preferences>;
  updatePreferences(patch: Partial<Preferences>): Promise<Preferences>;
  subscribe(listener: () => void): () => void;
  getCurrentTab(): Promise<CurrentTab | null>;
  clearCurrentTabLocalStorage(): Promise<void>;
  openWorkbench(): Promise<void>;
  openOptions(): Promise<void>;
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'system',
  protectedKeys: [],
  cleanOnStartup: false,
};

export const HOST_PERMISSIONS = ['http://*/*', 'https://*/*'];
