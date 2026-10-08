import type { CookieRecord, ValidationIssue } from './types';

export const LIMITS = {
  importBytes: 10 * 1024 * 1024,
  cookies: 10_000,
  fieldLength: 65_536,
  stores: 1_000,
} as const;

const COOKIE_FIELDS = new Set([
  'name',
  'value',
  'domain',
  'path',
  'secure',
  'httpOnly',
  'hostOnly',
  'session',
  'expirationDate',
  'sameSite',
  'storeId',
  'firstPartyDomain',
  'partitionKey',
]);
const SAME_SITE = new Set(['no_restriction', 'lax', 'strict', 'unspecified']);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The canonical host portion, without the historical leading domain dot. */
export function cookieDomain(domain: string): string {
  const hostname = domain.replace(/^\./, '').toLowerCase();
  try {
    return new URL(`https://${hostname}`).hostname;
  } catch {
    return hostname;
  }
}

/** Identity includes every isolation boundary, including Firefox containers and CHIPS. */
export function cookieKey(cookie: CookieRecord): string {
  let topLevelSite = cookie.partitionKey?.topLevelSite ?? null;
  if (topLevelSite) {
    try {
      topLevelSite = new URL(topLevelSite).origin;
    } catch {
      /* Validation reports malformed sites. */
    }
  }
  return JSON.stringify([
    cookie.storeId,
    cookieDomain(cookie.domain),
    cookie.hostOnly,
    cookie.path,
    cookie.name,
    cookie.firstPartyDomain ?? null,
    cookie.partitionKey === undefined
      ? null
      : [topLevelSite, cookie.partitionKey.hasCrossSiteAncestor ?? null],
  ]);
}

/** Whether a cookie's domain scope applies to a hostname (path is intentionally ignored). */
export function domainMatches(cookie: CookieRecord, hostname: string): boolean {
  const domain = cookieDomain(cookie.domain);
  const host = cookieDomain(hostname);
  return host === domain || (!cookie.hostOnly && host.endsWith(`.${domain}`));
}

/** Build an API URL without allowing a cookie path to change its origin. */
export function cookieUrl(cookie: Pick<CookieRecord, 'domain' | 'secure' | 'path'>): string {
  const url = new URL(`${cookie.secure ? 'https' : 'http'}://${cookieDomain(cookie.domain)}`);
  url.pathname = cookie.path;
  return url.href;
}

/** Validate an untrusted record. `now` is Unix seconds; null disables only the expiry-in-past check. */
export function validateCookie(
  value: unknown,
  options: { now?: number | null } = {},
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const error = (field: string, message: string) =>
    issues.push({ field, message, severity: 'error' });
  const warning = (field: string, message: string) =>
    issues.push({ field, message, severity: 'warning' });
  if (!isRecord(value))
    return [{ field: 'cookie', message: 'Cookie must be an object.', severity: 'error' }];

  for (const field of Object.keys(value)) {
    if (!COOKIE_FIELDS.has(field)) error(field, `Unsupported cookie field: ${field}.`);
  }
  for (const field of ['name', 'value', 'domain', 'path', 'storeId'] as const) {
    if (typeof value[field] !== 'string') error(field, `${field} must be a string.`);
    else if (value[field].length > LIMITS.fieldLength)
      error(field, `${field} exceeds the size limit.`);
  }
  for (const field of ['secure', 'httpOnly', 'hostOnly', 'session'] as const) {
    if (typeof value[field] !== 'boolean') error(field, `${field} must be a boolean.`);
  }
  if (typeof value.sameSite !== 'string' || !SAME_SITE.has(value.sameSite)) {
    error('sameSite', 'SameSite must be unspecified, lax, strict, or no_restriction.');
  }
  if (typeof value.name === 'string' && /[\x00-\x20\x7f()<>@,;:\\"/\[\]?={}]/.test(value.name)) {
    error('name', 'Cookie name contains a control character, whitespace, or separator.');
  }
  if (typeof value.value === 'string' && /[\x00-\x1f\x7f;]/.test(value.value)) {
    error('value', 'Cookie value contains a control character or semicolon.');
  }
  if (typeof value.domain === 'string') {
    const host = value.domain.replace(/^\./, '');
    try {
      const parsed = new URL(`https://${host}`);
      if (
        !host ||
        /[\s/\\?#@%]/.test(host) ||
        host.startsWith('.') ||
        host.endsWith('.') ||
        parsed.port ||
        parsed.username ||
        parsed.password ||
        parsed.pathname !== '/' ||
        (!host.startsWith('[') && host.includes(':')) ||
        (!parsed.hostname.startsWith('[') &&
          parsed.hostname
            .split('.')
            .some(
              (part) => !part || part.length > 63 || !/^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(part),
            ))
      ) {
        error(
          'domain',
          'Domain must be a hostname or IP address, without a scheme, port, or path.',
        );
      }
    } catch {
      error('domain', 'Domain must be a valid hostname or IP address.');
    }
    if (value.hostOnly === true && value.domain.startsWith('.')) {
      error('domain', 'Host-only cookies cannot have a leading domain dot.');
    }
  }
  if (
    typeof value.path === 'string' &&
    (!value.path.startsWith('/') || /[\x00-\x1f\x7f;]/.test(value.path))
  ) {
    error('path', 'Path must begin with / and contain no control characters or semicolons.');
  }
  if (
    typeof value.storeId === 'string' &&
    (!value.storeId || /[\x00-\x1f\x7f]/.test(value.storeId))
  ) {
    error('storeId', 'A nonempty cookie store ID is required.');
  }
  if (
    value.expirationDate !== undefined &&
    (typeof value.expirationDate !== 'number' ||
      !Number.isFinite(value.expirationDate) ||
      value.expirationDate <= 0 ||
      value.expirationDate > 8.64e12)
  ) {
    error('expirationDate', 'Expiration must be a positive, finite Unix timestamp in seconds.');
  } else if (value.session === false) {
    if (value.expirationDate === undefined)
      error('expirationDate', 'Persistent cookies require an expiration date.');
    else if (
      options.now !== null &&
      (value.expirationDate as number) <= (options.now ?? Date.now() / 1000)
    ) {
      error('expirationDate', 'Cookie has expired. Choose an expiration date in the future.');
    }
  } else if (value.session === true && value.expirationDate !== undefined) {
    error('expirationDate', 'Session cookies must not include an expiration date.');
  }
  if (typeof value.name === 'string') {
    if (value.name.startsWith('__Secure-') && value.secure !== true) {
      error('secure', '__Secure- cookies require Secure.');
    }
    if (value.name.startsWith('__Host-')) {
      if (value.secure !== true) error('secure', '__Host- cookies require Secure.');
      if (value.hostOnly !== true) error('hostOnly', '__Host- cookies must be host-only.');
      if (value.path !== '/') error('path', '__Host- cookies require the / path.');
    }
    if (value.name.startsWith('__Http-') || value.name.startsWith('__Host-Http-')) {
      if (value.secure !== true) error('secure', '__Http- cookies require Secure.');
      if (value.httpOnly !== true) error('httpOnly', '__Http- cookies require HttpOnly.');
    }
  }
  if (value.sameSite === 'no_restriction' && value.secure !== true) {
    error('sameSite', 'SameSite=None requires Secure in modern browsers.');
  }
  if (
    value.firstPartyDomain !== undefined &&
    (typeof value.firstPartyDomain !== 'string' ||
      value.firstPartyDomain.length > LIMITS.fieldLength ||
      /[\x00-\x1f\x7f]/.test(value.firstPartyDomain))
  ) {
    error('firstPartyDomain', 'First-party domain must be a string without control characters.');
  }
  if (value.partitionKey !== undefined) {
    if (!isRecord(value.partitionKey)) error('partitionKey', 'Partition key must be an object.');
    else {
      const partition = value.partitionKey;
      for (const field of Object.keys(partition)) {
        if (!['topLevelSite', 'hasCrossSiteAncestor'].includes(field)) {
          error('partitionKey', `Unsupported partition key field: ${field}.`);
        }
      }
      if (typeof partition.topLevelSite !== 'string' || !partition.topLevelSite) {
        error('partitionKey', 'Partition key requires a top-level site.');
      } else {
        try {
          const url = new URL(partition.topLevelSite);
          if (
            !['http:', 'https:'].includes(url.protocol) ||
            url.username ||
            url.password ||
            url.search ||
            url.hash ||
            url.pathname !== '/' ||
            partition.topLevelSite.length > LIMITS.fieldLength
          ) {
            error(
              'partitionKey',
              'Top-level site must be an HTTP(S) origin without a path or credentials.',
            );
          }
        } catch {
          error('partitionKey', 'Top-level site must be a valid HTTP(S) origin.');
        }
      }
      if (
        partition.hasCrossSiteAncestor !== undefined &&
        typeof partition.hasCrossSiteAncestor !== 'boolean'
      ) {
        error('partitionKey', 'hasCrossSiteAncestor must be a boolean.');
      }
      // Firefox's automatic state partitioning can include non-Secure cookies.
      // CHIPS writes in Chromium require Secure; the browser adapter enforces that rule.
      if (value.secure !== true)
        warning(
          'secure',
          'Chromium requires Secure for partitioned cookies; Firefox state partitioning may allow this cookie.',
        );
    }
  }
  if (
    typeof value.name === 'string' &&
    typeof value.value === 'string' &&
    new TextEncoder().encode(value.name + value.value).length > 4096
  ) {
    warning('value', 'Name and value exceed 4 KiB; some browsers may reject this cookie.');
  }
  return issues;
}
