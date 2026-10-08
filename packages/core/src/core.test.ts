import { describe, expect, it } from 'vitest';
import {
  cookieKey,
  cookieUrl,
  createBackup,
  domainMatches,
  exportNetscape,
  filterCookies,
  groupCookiesByDomain,
  importCookies,
  LIMITS,
  parseSearch,
  serializeBackup,
  validateCookie,
  type CookieRecord,
} from './index';

const NOW = 1_800_000_000;
const options = { storeId: 'firefox-default', now: NOW };
const cookie = (changes: Partial<CookieRecord> = {}): CookieRecord => ({
  name: 'session',
  value: 'abc',
  domain: 'example.com',
  path: '/',
  secure: true,
  httpOnly: true,
  hostOnly: true,
  session: true,
  sameSite: 'lax',
  storeId: 'firefox-default',
  ...changes,
});

describe('cookie identity and scope', () => {
  it('separates stores, paths, partitions, FPI, and ancestor state', () => {
    const records = [
      cookie(),
      cookie({ storeId: 'firefox-private' }),
      cookie({ path: '/account' }),
      cookie({ firstPartyDomain: 'example.net' }),
      cookie({ partitionKey: { topLevelSite: 'https://example.net' } }),
      cookie({
        partitionKey: { topLevelSite: 'https://example.net', hasCrossSiteAncestor: false },
      }),
      cookie({ partitionKey: { topLevelSite: 'https://example.net', hasCrossSiteAncestor: true } }),
    ];
    expect(new Set(records.map(cookieKey)).size).toBe(records.length);
  });

  it('normalizes equivalent domain spelling but never conflates names or paths', () => {
    expect(cookieKey(cookie({ domain: 'EXAMPLE.com' }))).toBe(cookieKey(cookie()));
    expect(cookieKey(cookie({ domain: '.EXAMPLE.com', hostOnly: false }))).toBe(
      cookieKey(cookie({ domain: 'example.com', hostOnly: false })),
    );
    expect(cookieKey(cookie())).not.toBe(
      cookieKey(cookie({ domain: '.example.com', hostOnly: false })),
    );
    expect(cookieKey(cookie({ name: 'Session' }))).not.toBe(cookieKey(cookie()));
    expect(cookieKey(cookie({ path: '/Account' }))).not.toBe(
      cookieKey(cookie({ path: '/account' })),
    );
    expect(cookieKey(cookie({ partitionKey: { topLevelSite: 'https://EXAMPLE.net/' } }))).toBe(
      cookieKey(cookie({ partitionKey: { topLevelSite: 'https://example.net' } })),
    );
  });

  it('matches host-only and domain scope without suffix confusion', () => {
    expect(domainMatches(cookie(), 'www.example.com')).toBe(false);
    expect(
      domainMatches(cookie({ hostOnly: false, domain: '.example.com' }), 'www.example.com'),
    ).toBe(true);
    expect(domainMatches(cookie({ hostOnly: false }), 'evil-example.com')).toBe(false);
    expect(domainMatches(cookie({ hostOnly: false }), 'example.com.evil.test')).toBe(false);
  });

  it('keeps hostile-looking paths on the original cookie origin', () => {
    expect(cookieUrl(cookie({ path: '//evil.test/path?query#hash' }))).toBe(
      'https://example.com//evil.test/path%3Fquery%23hash',
    );
    expect(cookieUrl(cookie({ secure: false, domain: '.example.com', hostOnly: false }))).toBe(
      'http://example.com/',
    );
  });
});

describe('validation', () => {
  it('accepts browser-neutral records and rejects implicit coercion', () => {
    expect(validateCookie(cookie())).toEqual([]);
    expect(validateCookie({ ...cookie(), secure: 'false' })).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'secure', severity: 'error' })]),
    );
  });

  it.each([
    cookie({ domain: 'user@example.com' }),
    cookie({ domain: 'example.com:8080' }),
    cookie({ domain: 'example.com/path' }),
    cookie({ domain: '.example.com' }),
    cookie({ name: 'bad\r\nname' }),
    cookie({ value: 'injected\tvalue' }),
    cookie({ path: 'account' }),
    cookie({ storeId: '' }),
    cookie({ session: false }),
    cookie({ session: true, expirationDate: NOW + 100 }),
    cookie({ session: false, expirationDate: Number.NaN }),
    cookie({ session: false, expirationDate: NOW - 1 }),
    cookie({ name: '__Secure-token', secure: false }),
    cookie({ name: '__Host-token', hostOnly: false }),
    cookie({ name: '__Host-token', path: '/account' }),
    cookie({ name: '__Http-token', httpOnly: false }),
    cookie({ name: '__Host-Http-token', httpOnly: false }),
    cookie({ sameSite: 'no_restriction', secure: false }),
    cookie({ partitionKey: { topLevelSite: 'https://example.net/path' } }),
    cookie({ partitionKey: { topLevelSite: 'file:///tmp/cookies' } }),
  ])('reports invalid cookies rather than silently changing them: %j', (invalid) => {
    expect(validateCookie(invalid, { now: NOW }).some((issue) => issue.severity === 'error')).toBe(
      true,
    );
  });

  it('accepts international domains, localhost, IPv4, and IPv6', () => {
    for (const domain of ['münich.example', 'localhost', '127.0.0.1', '[::1]']) {
      expect(validateCookie(cookie({ domain }))).toEqual([]);
    }
  });

  it('warns about browser size limits without rejecting a lossless backup', () => {
    expect(validateCookie(cookie({ value: 'x'.repeat(4097) }))).toEqual([
      expect.objectContaining({ severity: 'warning' }),
    ]);
  });

  it('preserves non-Secure Firefox state partitioning and warns about Chromium compatibility', () => {
    const record = cookie({ partitionKey: { topLevelSite: 'http://example.net' }, secure: false });
    const issues = validateCookie(record);
    expect(issues).toEqual([expect.objectContaining({ field: 'secure', severity: 'warning' })]);
    expect(importCookies(serializeBackup([record]), options).cookies).toEqual([record]);
  });

  it('rejects unknown security metadata instead of dropping it', () => {
    expect(
      validateCookie({
        ...cookie(),
        partitionKey: { topLevelSite: 'https://example.net', opaque: true },
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'partitionKey', severity: 'error' }),
      ]),
    );
  });
});

describe('search and grouping', () => {
  const records = [
    cookie({ name: 'theme', value: 'dark mode', httpOnly: false }),
    cookie({ name: 'token', domain: '.example.com', hostOnly: false }),
    cookie({ name: 'theme', domain: 'elsewhere.test', storeId: 'firefox-private' }),
  ];

  it('combines quoted field terms, flags, and negation', () => {
    expect(filterCookies(records, 'name:theme value:"dark mode" -is:httponly')).toEqual([
      records[0],
    ]);
    expect(filterCookies(records, 'is:secure domain:example -name:theme')).toEqual([records[1]]);
    expect(filterCookies(records, 'store:private')).toEqual([records[2]]);
    expect(parseSearch('value:"an \\"escaped\\" phrase"')[0]?.field).toBe('value');
  });

  it('uses applicability for a current-site filter and exact store identity', () => {
    expect(filterCookies(records, '', { domain: 'sub.example.com' })).toEqual([records[1]]);
    expect(filterCookies(records, '', { storeId: 'firefox-private' })).toEqual([records[2]]);
  });

  it('groups equivalent domains and sorts without mutating input', () => {
    const original = [...records];
    expect(
      groupCookiesByDomain(records).map((group) => [group.domain, group.cookies.length]),
    ).toEqual([
      ['elsewhere.test', 1],
      ['example.com', 2],
    ]);
    expect(records).toEqual(original);
  });
});

describe('Cookie Loom JSON backups', () => {
  it('round-trips full isolation and store metadata', () => {
    const records = [
      cookie({
        storeId: 'firefox-container-3',
        firstPartyDomain: 'example.net',
        partitionKey: { topLevelSite: 'https://example.net', hasCrossSiteAncestor: true },
      }),
    ];
    const stores = [{ id: 'firefox-container-3', name: 'Work', incognito: false, color: 'teal' }];
    const backup = createBackup(records, stores);
    expect(backup.stores).toEqual(stores);
    expect(backup.cookies).not.toBe(records);
    const imported = importCookies(serializeBackup(records, stores), options);
    expect(imported.format).toBe('cookie-loom');
    expect(imported.errors).toEqual([]);
    expect(imported.warnings).toEqual([]);
    expect(imported.cookies).toEqual(records);
  });

  it('rejects bad versions, unknown fields, bad stores, and malformed JSON', () => {
    for (const text of [
      '{',
      JSON.stringify({ ...createBackup([]), version: 2 }),
      JSON.stringify({ ...createBackup([]), unsafe: true }),
      JSON.stringify({
        ...createBackup([]),
        stores: [{ id: 'default', name: 'Bad', incognito: 'false' }],
      }),
    ]) {
      const result = importCookies(text, options);
      expect(result.cookies).toEqual([]);
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it('returns individual validation failures for preview without accepting invalid records', () => {
    const backup = createBackup([cookie()]);
    const result = importCookies(
      JSON.stringify({
        ...backup,
        cookies: [cookie(), { ...cookie({ name: 'bad' }), secure: 'true' }],
      }),
      options,
    );
    expect(result.cookies).toEqual([cookie()]);
    expect(result.errors).toEqual([expect.objectContaining({ index: 1 })]);
  });

  it('rejects duplicates while keeping independent partitions', () => {
    const backup = createBackup([]);
    const result = importCookies(
      JSON.stringify({
        ...backup,
        cookies: [cookie(), cookie(), cookie({ storeId: 'firefox-private' })],
      }),
      options,
    );
    expect(result.cookies).toHaveLength(2);
    expect(result.errors[0]?.message).toMatch(/Duplicate/);
  });

  it('preserves host-only and domain cookies with otherwise identical identity', () => {
    const records = [cookie(), cookie({ domain: '.example.com', hostOnly: false })];
    expect(importCookies(serializeBackup(records), options).cookies).toEqual(records);
  });

  it('bounds input sizes and record counts before import', () => {
    expect(importCookies('x'.repeat(LIMITS.importBytes + 1), options).errors[0]?.message).toMatch(
      /10 MiB/,
    );
    expect(
      importCookies(JSON.stringify(Array.from({ length: LIMITS.cookies + 1 }, () => ({}))), options)
        .errors[0]?.message,
    ).toMatch(/more than/);
  });

  it('rejects expired cookies before they can become accidental deletions', () => {
    const backup = createBackup([cookie({ session: false, expirationDate: NOW - 1 })]);
    const result = importCookies(JSON.stringify(backup), options);
    expect(result.cookies).toEqual([]);
    expect(result.errors[0]?.message).toMatch(/expired/);
  });
});

describe('legacy Cookie Quick Manager migration', () => {
  const legacy = {
    'Host raw': 'https://.example.com/',
    'Name raw': 'token',
    'Path raw': '/',
    'Content raw': 'abc',
    Expires: 'At the end of the session',
    'Expires raw': '0',
    'Send for': 'Encrypted connections only',
    'Send for raw': 'true',
    'HTTP only raw': 'false',
    'SameSite raw': 'lax',
    'This domain only': 'Valid for subdomains',
    'This domain only raw': 'false',
    'Store raw': 'firefox-container-2',
    'First Party Domain': 'example.net',
  };

  it('reads actual legacy string booleans and preserves containers/FPI', () => {
    const result = importCookies(JSON.stringify([legacy]), options);
    expect(result.errors).toEqual([]);
    expect(result.cookies[0]).toEqual(
      cookie({
        name: 'token',
        domain: '.example.com',
        hostOnly: false,
        httpOnly: false,
        storeId: 'firefox-container-2',
        firstPartyDomain: 'example.net',
      }),
    );
    expect(result.warnings.join(' ')).toMatch(/partition keys/);
  });

  it('rejects misleading booleans instead of truthiness conversion', () => {
    const result = importCookies(JSON.stringify([{ ...legacy, 'Send for raw': 'yes' }]), options);
    expect(result.cookies).toEqual([]);
    expect(result.errors[0]?.message).toMatch(/true or false/);
  });

  it('rejects unknown legacy metadata and malicious cookie URLs', () => {
    for (const bad of [
      { ...legacy, partitioned: true },
      { ...legacy, 'Host raw': 'javascript:alert(1)' },
    ]) {
      expect(importCookies(JSON.stringify([bad]), options).errors).toHaveLength(1);
    }
  });
});

describe('Netscape format', () => {
  it('uses standard include-subdomains semantics and preserves HttpOnly with its conventional prefix', () => {
    const records = [
      cookie({ domain: '.example.com', hostOnly: false }),
      cookie({ name: 'empty', value: '', httpOnly: false }),
    ];
    const exported = exportNetscape(records);
    expect(exported.text).toContain('#HttpOnly_.example.com\tTRUE\t/\tTRUE\t0\tsession\tabc');
    expect(exported.warnings.join(' ')).toMatch(/cannot preserve SameSite/);
    const imported = importCookies(exported.text, options);
    expect(imported.errors).toEqual([]);
    expect(imported.cookies).toEqual(
      records.map((record) => ({ ...record, sameSite: 'unspecified' })),
    );
  });

  it.each([
    ['example.com', 'TRUE', '.example.com', false],
    ['.example.com', 'FALSE', 'example.com', true],
  ] as const)(
    'honors the standard scope flag for %s %s',
    (domain, flag, expectedDomain, hostOnly) => {
      const result = importCookies(`${domain}\t${flag}\t/\tTRUE\t0\ttoken\tabc`, options);
      expect(result.errors).toEqual([]);
      expect(result.cookies[0]).toMatchObject({ domain: expectedDomain, hostOnly });
      expect(result.warnings.join(' ')).not.toMatch(/Legacy Cookie Quick Manager mode/);
    },
  );

  it.each([
    ['example.com', 'TRUE', 'example.com', true],
    ['.example.com', 'FALSE', '.example.com', false],
  ] as const)(
    'repairs old CQM scope only with explicit opt-in for %s %s',
    (domain, flag, expectedDomain, hostOnly) => {
      const result = importCookies(`${domain}\t${flag}\t/\tTRUE\t0\ttoken\tabc`, {
        ...options,
        netscapeMode: 'legacy-cqm',
      });
      expect(result.errors).toEqual([]);
      expect(result.cookies[0]).toMatchObject({ domain: expectedDomain, hostOnly });
      expect(result.warnings.join(' ')).toMatch(/Legacy Cookie Quick Manager mode is enabled/);
    },
  );

  it('normalizes only the scope dot and continues rejecting malformed domains', () => {
    for (const domain of ['..example.com', 'example.com/path', 'example.com:123']) {
      expect(importCookies(`${domain}\tTRUE\t/\tTRUE\t0\ttoken\tabc`, options).errors).toHaveLength(
        1,
      );
    }
  });

  it('reports malformed records and expired dates with line numbers', () => {
    const result = importCookies(
      `# comment\nexample.com\tFALSE\t/\tmaybe\t0\ttoken\tabc\nexample.com\tFALSE\t/\tTRUE\t${NOW - 1}\ttoken\tabc`,
      options,
    );
    expect(result.cookies).toEqual([]);
    expect(result.errors.map((error) => error.line)).toEqual([2, 3]);
  });

  it('makes partition loss explicit and refuses record injection', () => {
    expect(
      exportNetscape([
        cookie({ partitionKey: { topLevelSite: 'https://example.net' } }),
      ]).warnings.join(' '),
    ).toMatch(/create unpartitioned cookies/);
    expect(() => exportNetscape([cookie({ value: 'a\nb' })])).toThrow(/control character/);
  });
});
