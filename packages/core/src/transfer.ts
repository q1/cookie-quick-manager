import { cookieDomain, cookieKey, isRecord, LIMITS, validateCookie } from './cookie';
import type {
  CookieBackupV1,
  CookieRecord,
  CookieStore,
  ImportOptions,
  ImportResult,
  SameSite,
} from './types';

const NETSCAPE_LOSS =
  'Netscape format cannot preserve SameSite, cookie stores, first-party isolation, or partition keys. Use Cookie Loom JSON for a full-fidelity backup.';
const LEGACY_LOSS =
  'Legacy JSON does not record partition keys. Isolation metadata absent from the original export cannot be recovered.';

function assertExportable(cookies: readonly CookieRecord[]): void {
  if (cookies.length > LIMITS.cookies)
    throw new Error(`At most ${LIMITS.cookies} cookies can be exported at once.`);
  const keys = new Set<string>();
  for (const [index, cookie] of cookies.entries()) {
    const errors = validateCookie(cookie, { now: null }).filter(
      (issue) => issue.severity === 'error',
    );
    if (errors.length)
      throw new Error(`Cookie ${index + 1}: ${errors.map((issue) => issue.message).join(' ')}`);
    const key = cookieKey(cookie);
    if (keys.has(key)) throw new Error(`Cookie ${index + 1} has a duplicate identity.`);
    keys.add(key);
  }
}

function storeError(value: unknown): string | undefined {
  if (!isRecord(value)) return 'Store must be an object.';
  if (Object.keys(value).some((key) => !['id', 'name', 'incognito', 'color'].includes(key)))
    return 'Store has unsupported fields.';
  if (
    typeof value.id !== 'string' ||
    !value.id ||
    value.id.length > LIMITS.fieldLength ||
    /[\x00-\x1f\x7f]/.test(value.id)
  ) {
    return 'Store requires a nonempty ID without control characters.';
  }
  if (
    typeof value.name !== 'string' ||
    value.name.length > LIMITS.fieldLength ||
    typeof value.incognito !== 'boolean'
  ) {
    return 'Store name must be a string and incognito must be a boolean.';
  }
  if (value.color !== undefined && (typeof value.color !== 'string' || value.color.length > 128))
    return 'Store color must be a short string.';
  return undefined;
}

export function createBackup(
  cookies: readonly CookieRecord[],
  stores: readonly CookieStore[] = [],
): CookieBackupV1 {
  assertExportable(cookies);
  if (stores.length > LIMITS.stores) throw new Error('Too many cookie stores.');
  const storeIds = new Set<string>();
  for (const store of stores) {
    const error = storeError(store);
    if (error) throw new Error(error);
    if (storeIds.has(store.id)) throw new Error(`Duplicate store ID: ${store.id}.`);
    storeIds.add(store.id);
  }
  return {
    format: 'cookie-loom',
    version: 1,
    exportedAt: new Date().toISOString(),
    cookies: JSON.parse(JSON.stringify(cookies)) as CookieRecord[],
    stores: stores.map((store) => ({ ...store })),
  };
}

export function serializeBackup(
  cookies: readonly CookieRecord[],
  stores: readonly CookieStore[] = [],
): string {
  const text = JSON.stringify(createBackup(cookies, stores), null, 2);
  if (new TextEncoder().encode(text).length > LIMITS.importBytes) {
    throw new Error('Backup exceeds the 10 MiB import limit. Export a smaller selection.');
  }
  return text;
}

export function exportNetscape(cookies: readonly CookieRecord[]): {
  text: string;
  warnings: string[];
} {
  assertExportable(cookies);
  const warnings = [NETSCAPE_LOSS];
  if (cookies.some((cookie) => cookie.partitionKey || cookie.firstPartyDomain)) {
    warnings.push(
      'These cookies use isolation metadata. Restoring this Netscape export would create unpartitioned cookies.',
    );
  }
  if (
    cookies.some(
      (cookie) => cookie.expirationDate !== undefined && !Number.isInteger(cookie.expirationDate),
    )
  ) {
    warnings.push('Fractional expiration timestamps are rounded down to whole seconds.');
  }
  const rows = cookies.map((cookie) => {
    const domain = `${cookie.hostOnly ? '' : '.'}${cookieDomain(cookie.domain)}`;
    return [
      `${cookie.httpOnly ? '#HttpOnly_' : ''}${domain}`,
      cookie.hostOnly ? 'FALSE' : 'TRUE',
      cookie.path,
      cookie.secure ? 'TRUE' : 'FALSE',
      cookie.session ? '0' : String(Math.floor(cookie.expirationDate!)),
      cookie.name,
      cookie.value,
    ].join('\t');
  });
  const text = [
    '# Netscape HTTP Cookie File',
    '# Exported by Cookie Loom. This format loses isolation metadata; prefer JSON.',
    '',
    ...rows,
    '',
  ].join('\n');
  if (new TextEncoder().encode(text).length > LIMITS.importBytes)
    throw new Error('Export exceeds the 10 MiB import limit.');
  return { text, warnings };
}

function booleanField(value: unknown, field: string): boolean {
  if (value === true || value === 'true' || value === 'TRUE') return true;
  if (value === false || value === 'false' || value === 'FALSE') return false;
  throw new Error(`${field} must be true or false.`);
}

function textField(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`${field} must be a string.`);
  return value;
}

function expiration(value: unknown): number | undefined {
  if (
    typeof value !== 'number' &&
    (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value))
  ) {
    throw new Error('Expiration must be a Unix timestamp, or 0 for a session cookie.');
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error('Invalid expiration timestamp.');
  return number === 0 ? undefined : number;
}

function legacyCookie(value: unknown, options: ImportOptions, warnings: Set<string>): CookieRecord {
  if (!isRecord(value)) throw new Error('Cookie must be an object.');
  // Also accept a plain WebExtensions record array, while applying the same strict schema.
  if (!Object.hasOwn(value, 'Host raw')) return value as unknown as CookieRecord;
  const legacyFields = new Set([
    'Host raw',
    'Name raw',
    'Path raw',
    'Content raw',
    'Expires',
    'Expires raw',
    'Send for',
    'Send for raw',
    'HTTP only raw',
    'SameSite raw',
    'This domain only',
    'This domain only raw',
    'Store raw',
    'First Party Domain',
    'Private raw',
  ]);
  for (const field of Object.keys(value)) {
    if (!legacyFields.has(field)) throw new Error(`Unsupported legacy cookie field: ${field}.`);
  }
  const url = new URL(textField(value['Host raw'], 'Host raw'));
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'Host raw must be an HTTP(S) cookie URL without credentials, port, query, or fragment.',
    );
  }
  const hostOnly =
    value['This domain only raw'] === undefined
      ? !url.hostname.startsWith('.')
      : booleanField(value['This domain only raw'], 'This domain only raw');
  if (value['This domain only raw'] === undefined)
    warnings.add('A legacy cookie lacks its host-only flag; scope was inferred from its hostname.');
  let storeId: string;
  if (value['Store raw'] !== undefined) storeId = textField(value['Store raw'], 'Store raw');
  else if (value['Private raw'] !== undefined && booleanField(value['Private raw'], 'Private raw'))
    storeId = 'firefox-private';
  else {
    storeId = options.storeId;
    warnings.add(`Legacy cookies without a store ID use the selected store (${storeId}).`);
  }
  const expiry = expiration(value['Expires raw']);
  const cookie: CookieRecord = {
    domain: `${hostOnly ? '' : '.'}${cookieDomain(url.hostname)}`,
    name: textField(value['Name raw'], 'Name raw'),
    value: textField(value['Content raw'], 'Content raw'),
    path: textField(value['Path raw'], 'Path raw'),
    secure: booleanField(value['Send for raw'], 'Send for raw'),
    httpOnly: booleanField(value['HTTP only raw'], 'HTTP only raw'),
    hostOnly,
    session: expiry === undefined,
    sameSite:
      value['SameSite raw'] === undefined
        ? 'unspecified'
        : (textField(value['SameSite raw'], 'SameSite raw') as SameSite),
    storeId,
  };
  if ((url.protocol === 'https:') !== cookie.secure)
    throw new Error('Host raw scheme disagrees with the Secure flag.');
  if (expiry !== undefined) cookie.expirationDate = expiry;
  if (value['First Party Domain'] !== undefined)
    cookie.firstPartyDomain = textField(value['First Party Domain'], 'First Party Domain');
  return cookie;
}

/** Parse and validate a backup for preview. This function never changes browser cookies. */
export function importCookies(text: string, options: ImportOptions): ImportResult {
  const content = text.replace(/^\uFEFF/, '');
  const trimmed = content.trim();
  const format: ImportResult['format'] = /^[\[{]/.test(trimmed) ? 'legacy-json' : 'netscape';
  const result: ImportResult = { format, cookies: [], warnings: [], errors: [] };
  const warnings = new Set<string>();
  if (
    text.length > LIMITS.importBytes ||
    new TextEncoder().encode(text).length > LIMITS.importBytes
  ) {
    result.errors.push({ message: 'File exceeds the 10 MiB import limit.' });
    return result;
  }
  if (!trimmed) {
    result.errors.push({ message: 'Import file is empty.' });
    return result;
  }
  if (
    typeof options.storeId !== 'string' ||
    !options.storeId ||
    /[\x00-\x1f\x7f]/.test(options.storeId)
  ) {
    result.errors.push({ message: 'Select a valid destination cookie store before importing.' });
    return result;
  }
  if (options.now !== undefined && (!Number.isFinite(options.now) || options.now < 0)) {
    result.errors.push({ message: 'Current time must be a finite Unix timestamp in seconds.' });
    return result;
  }
  const keys = new Set<string>();
  const add = (value: unknown, location: { index?: number; line?: number }) => {
    const issues = validateCookie(value, { now: options.now });
    const errors = issues.filter((issue) => issue.severity === 'error');
    if (errors.length) {
      result.errors.push({ ...location, message: errors.map((issue) => issue.message).join(' ') });
      return;
    }
    const cookie = value as CookieRecord;
    const key = cookieKey(cookie);
    if (keys.has(key)) {
      result.errors.push({
        ...location,
        message:
          'Duplicate cookie identity; each store, partition, domain, path, and name must be unique.',
      });
      return;
    }
    keys.add(key);
    for (const issue of issues) warnings.add(issue.message);
    result.cookies.push(cookie);
  };
  try {
    if (format !== 'netscape') {
      const json: unknown = JSON.parse(trimmed);
      let entries: unknown[];
      if (Array.isArray(json)) {
        entries = json;
        warnings.add(LEGACY_LOSS);
      } else {
        result.format = 'cookie-loom';
        if (!isRecord(json) || json.format !== 'cookie-loom' || json.version !== 1) {
          throw new Error(
            'Unsupported JSON backup format or version. Expected Cookie Loom version 1 or a legacy cookie array.',
          );
        }
        if (
          Object.keys(json).some(
            (key) => !['format', 'version', 'exportedAt', 'cookies', 'stores'].includes(key),
          )
        ) {
          throw new Error(
            'Backup contains unsupported fields. A newer backup format may be required.',
          );
        }
        if (typeof json.exportedAt !== 'string' || !Number.isFinite(Date.parse(json.exportedAt)))
          throw new Error('Backup requires a valid exportedAt timestamp.');
        if (!Array.isArray(json.cookies) || !Array.isArray(json.stores))
          throw new Error('Backup must contain cookies and stores arrays.');
        if (json.stores.length > LIMITS.stores)
          throw new Error('Backup contains too many cookie stores.');
        const storeIds = new Set<string>();
        for (const store of json.stores) {
          const error = storeError(store);
          if (error) throw new Error(error);
          const id = (store as CookieStore).id;
          if (storeIds.has(id)) throw new Error(`Duplicate store ID: ${id}.`);
          storeIds.add(id);
        }
        entries = json.cookies;
      }
      if (entries.length > LIMITS.cookies)
        throw new Error(`Import contains more than ${LIMITS.cookies} cookies.`);
      for (const [index, entry] of entries.entries()) {
        try {
          add(result.format === 'legacy-json' ? legacyCookie(entry, options, warnings) : entry, {
            index,
          });
        } catch (error) {
          result.errors.push({
            index,
            message: error instanceof Error ? error.message : 'Invalid cookie.',
          });
        }
      }
    } else {
      warnings.add(NETSCAPE_LOSS);
      warnings.add(
        `Netscape cookies use the selected store (${options.storeId}) and SameSite=unspecified.`,
      );
      // Do not trim records: the last field may intentionally be an empty value.
      const lines = content.split(/\r\n|\n|\r/);
      let records = 0;
      for (const [index, original] of lines.entries()) {
        if (!original.trim() || (original.startsWith('#') && !original.startsWith('#HttpOnly_')))
          continue;
        records++;
        if (records > LIMITS.cookies)
          throw new Error(`Import contains more than ${LIMITS.cookies} cookie rows.`);
        try {
          const httpOnly = original.startsWith('#HttpOnly_');
          const line = httpOnly ? original.slice('#HttpOnly_'.length) : original;
          const fields = line.split('\t');
          if (fields.length !== 7)
            throw new Error('Expected exactly seven tab-separated Netscape fields.');
          const [domain, includeSubdomains, path, secure, expires, name, value] = fields as [
            string,
            string,
            string,
            string,
            string,
            string,
            string,
          ];
          const flag = booleanField(includeSubdomains, 'Include subdomains');
          const dotted = domain.startsWith('.');
          // Cookie Quick Manager wrote the inverse of Netscape's second column.
          // Its leading domain dot is the only surviving indication of original scope.
          if (flag !== dotted)
            warnings.add(
              'A Netscape domain flag conflicts with its leading dot. Scope was inferred from the dot to support legacy Cookie Quick Manager exports; review it before importing.',
            );
          const expiry = expiration(expires);
          const cookie: CookieRecord = {
            domain,
            path,
            name,
            value,
            secure: booleanField(secure, 'Secure'),
            httpOnly,
            hostOnly: !dotted,
            session: expiry === undefined,
            sameSite: 'unspecified',
            storeId: options.storeId,
          };
          if (expiry !== undefined) cookie.expirationDate = expiry;
          add(cookie, { line: index + 1 });
        } catch (error) {
          result.errors.push({
            line: index + 1,
            message: error instanceof Error ? error.message : 'Invalid Netscape row.',
          });
        }
      }
      if (!records) result.errors.push({ message: 'No cookie rows found in the Netscape file.' });
    }
  } catch (error) {
    result.cookies = [];
    result.errors.push({
      message: error instanceof Error ? error.message : 'Invalid import file.',
    });
  }
  result.warnings = [...warnings];
  return result;
}
