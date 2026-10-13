import { useMemo, useState } from 'react';
import { Cookie, Shield, Settings, Globe2, LockKeyhole } from 'lucide-react';
import { cookieKey } from '@cookie-loom/core';
import { Brand } from './shared';
import { useWorkspace } from './context';

export type View = 'cookies' | 'protected' | 'settings';
export function Sidebar({
  view,
  domain,
  onNavigate,
}: {
  view: View;
  domain: string;
  onNavigate: (view: View, domain?: string) => void;
}) {
  const { cookies, gateway, preferences, domains } = useWorkspace();
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(50);
  const groups = useMemo(
    () => domains.filter((group) => group.domain.toLowerCase().includes(query.toLowerCase())),
    [domains, query],
  );
  const visibleGroups = groups.slice(0, limit);
  const active = groups.find((group) => group.domain === domain);
  if (active && !visibleGroups.includes(active)) visibleGroups.unshift(active);
  const protectedCount = useMemo(() => {
    const keys = new Set(preferences.protectedKeys);
    return cookies.filter((cookie) => keys.has(cookieKey(cookie))).length;
  }, [cookies, preferences.protectedKeys]);
  return (
    <aside className="sidebar">
      <Brand />
      <nav className="workspace-nav" aria-label="Workspace">
        <button
          className={`nav-item ${view === 'cookies' && !domain ? 'active' : ''}`}
          aria-current={view === 'cookies' && !domain ? 'page' : undefined}
          onClick={() => onNavigate('cookies')}
        >
          <Cookie size={17} />
          <span>Cookies</span>
          <span className="count" aria-hidden="true">
            {cookies.length}
          </span>
        </button>
        <button
          className={`nav-item ${view === 'protected' ? 'active' : ''}`}
          aria-current={view === 'protected' ? 'page' : undefined}
          onClick={() => onNavigate('protected')}
        >
          <Shield size={17} />
          <span>Protected</span>
          <span className="count" aria-hidden="true">
            {protectedCount}
          </span>
        </button>
        <button
          className={`nav-item ${view === 'settings' ? 'active' : ''}`}
          aria-current={view === 'settings' ? 'page' : undefined}
          onClick={() => onNavigate('settings')}
        >
          <Settings size={17} />
          <span>Settings</span>
        </button>
      </nav>
      <nav className="domain-nav" aria-label="Cookie domains">
        <div className="nav-label">Domains</div>
        {domains.length > 8 && (
          <input
            className="domain-search"
            type="search"
            aria-label="Find a domain"
            placeholder="Find a domain…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setLimit(50);
            }}
          />
        )}
        {visibleGroups.map((group) => (
          <button
            key={group.domain}
            className={`nav-item domain-item ${domain === group.domain && view === 'cookies' ? 'active' : ''}`}
            aria-current={domain === group.domain && view === 'cookies' ? 'page' : undefined}
            onClick={() => onNavigate('cookies', group.domain)}
            title={group.domain}
          >
            <Globe2 size={16} />
            <span>{group.domain}</span>
            <span className="count" aria-hidden="true">
              {group.count}
            </span>
          </button>
        ))}
        {groups.length > visibleGroups.length && (
          <button
            className="text-button domain-more"
            onClick={() => setLimit((value) => value + 50)}
          >
            Show more domains ({groups.length - visibleGroups.length})
          </button>
        )}
        {query && !groups.length && <p className="small muted nav-empty">No matching domains</p>}
        {cookies.length === 0 && <p className="small muted nav-empty">No domains</p>}
      </nav>
      <div className="privacy-foot">
        <LockKeyhole size={13} />
        <span>Local only</span>
        {gateway.kind === 'demo' && <span className="demo-label">Demo</span>}
      </div>
    </aside>
  );
}
