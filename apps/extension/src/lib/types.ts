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

export interface CookieReadOptions {
  /** Known stores from this refresh; omitted by background callers. */
  storeIds?: string[];
  /** Include every path and parent-domain cookie that applies to this host. */
  host?: string;
}

export interface Gateway {
  readonly kind: 'browser' | 'demo';
  getStatus(): Promise<GatewayStatus>;
  requestHostAccess(): Promise<boolean>;
  listStores(): Promise<CookieStore[]>;
  listCookies(options?: CookieReadOptions): Promise<CookieRecord[]>;
  saveCookie(cookie: CookieRecord, original?: CookieRecord): Promise<CookieRecord>;
  deleteCookies(cookies: CookieRecord[]): Promise<DeleteResult>;
  getPreferences(): Promise<Preferences>;
  updatePreferences(patch: Partial<Preferences>): Promise<Preferences>;
  setProtection(cookies: CookieRecord[], value: boolean): Promise<Preferences>;
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
