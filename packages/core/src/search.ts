import { cookieDomain, domainMatches } from './cookie';
import type { CookieRecord } from './types';

export interface SearchTerm {
  field?: string;
  value: string;
  negated: boolean;
}

/** Quoted phrases, optional field prefixes, and -negation; no regular expression execution. */
export function parseSearch(query: string): SearchTerm[] {
  const tokens: string[] = [];
  let token = '';
  let quoted = false;
  let escaped = false;
  for (const character of query) {
    if (escaped) {
      token += character;
      escaped = false;
    } else if (character === '\\' && quoted) escaped = true;
    else if (character === '"') quoted = !quoted;
    else if (/\s/.test(character) && !quoted) {
      if (token) tokens.push(token);
      token = '';
    } else token += character;
  }
  if (escaped) token += '\\';
  if (token) tokens.push(token);
  return tokens.map((raw) => {
    const negated = raw.startsWith('-') && raw.length > 1;
    const text = negated ? raw.slice(1) : raw;
    const colon = text.indexOf(':');
    if (
      colon > 0 &&
      ['domain', 'name', 'value', 'store', 'path', 'is', 'samesite'].includes(
        text.slice(0, colon).toLowerCase(),
      )
    ) {
      return {
        field: text.slice(0, colon).toLowerCase(),
        value: text.slice(colon + 1).toLowerCase(),
        negated,
      };
    }
    return { value: text.toLowerCase(), negated };
  });
}

export function filterCookies(
  cookies: readonly CookieRecord[],
  query = '',
  options: { storeId?: string; domain?: string; now?: number } = {},
): CookieRecord[] {
  const terms = parseSearch(query);
  const now = options.now ?? Date.now() / 1000;
  return cookies.filter((cookie) => {
    if (options.storeId && cookie.storeId !== options.storeId) return false;
    if (options.domain && !domainMatches(cookie, options.domain)) return false;
    return terms.every((term) => {
      const includes = (value: string) => value.toLowerCase().includes(term.value);
      let matches: boolean;
      switch (term.field) {
        case 'domain':
          matches = includes(cookie.domain);
          break;
        case 'name':
          matches = includes(cookie.name);
          break;
        case 'value':
          matches = includes(cookie.value);
          break;
        case 'store':
          matches = includes(cookie.storeId);
          break;
        case 'path':
          matches = includes(cookie.path);
          break;
        case 'samesite':
          matches = includes(cookie.sameSite);
          break;
        case 'is':
          matches =
            (
              {
                secure: cookie.secure,
                httponly: cookie.httpOnly,
                session: cookie.session,
                persistent: !cookie.session,
                hostonly: cookie.hostOnly,
                domain: !cookie.hostOnly,
                partitioned: cookie.partitionKey !== undefined,
                firstparty: Boolean(cookie.firstPartyDomain),
                expired:
                  !cookie.session &&
                  cookie.expirationDate !== undefined &&
                  cookie.expirationDate <= now,
              } as Record<string, boolean>
            )[term.value] ?? false;
          break;
        default:
          matches = [cookie.name, cookie.value, cookie.domain, cookie.path, cookie.storeId].some(
            includes,
          );
      }
      return term.negated ? !matches : matches;
    });
  });
}

export function groupCookiesByDomain(
  cookies: readonly CookieRecord[],
): { domain: string; cookies: CookieRecord[] }[] {
  const groups = new Map<string, CookieRecord[]>();
  for (const cookie of cookies) {
    const domain = cookieDomain(cookie.domain);
    const group = groups.get(domain) ?? [];
    group.push(cookie);
    groups.set(domain, group);
  }
  return [...groups]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([domain, grouped]) => ({
      domain,
      cookies: grouped.sort(
        (left, right) => left.name.localeCompare(right.name) || left.path.localeCompare(right.path),
      ),
    }));
}
