/** Browser-neutral cookie data. Timestamps are Unix seconds, as in WebExtensions. */
export type SameSite = 'no_restriction' | 'lax' | 'strict' | 'unspecified';

export interface CookiePartitionKey {
  topLevelSite?: string;
  hasCrossSiteAncestor?: boolean;
}

export interface CookieRecord {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  hostOnly: boolean;
  session: boolean;
  expirationDate?: number;
  sameSite: SameSite;
  storeId: string;
  firstPartyDomain?: string;
  partitionKey?: CookiePartitionKey;
}

export interface CookieStore {
  id: string;
  name: string;
  incognito: boolean;
  color?: string;
}

export interface ValidationIssue {
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface CookieBackupV1 {
  format: 'cookie-loom';
  version: 1;
  exportedAt: string;
  cookies: CookieRecord[];
  stores: CookieStore[];
}

export interface ImportError {
  /** Zero-based cookie index in JSON input. */
  index?: number;
  /** One-based line in Netscape input. */
  line?: number;
  message: string;
}

export interface ImportResult {
  format: 'cookie-loom' | 'legacy-json' | 'netscape';
  cookies: CookieRecord[];
  warnings: string[];
  errors: ImportError[];
}

export interface ImportOptions {
  /** Explicit fallback for formats without a cookie store. Never overrides saved stores. */
  storeId: string;
  /** Current Unix time in seconds, primarily useful for deterministic previews/tests. */
  now?: number;
}
