import { useEffect, useRef } from 'react';
import { LockKeyhole, ShieldCheck, KeyRound, Layers, ArrowUp, ArrowDown, Copy } from 'lucide-react';
import { cookieKey, type CookieRecord } from '@cookie-loom/core';
import { expiryLabel } from './shared';

export type Sort = { field: 'name' | 'domain' | 'expirationDate'; direction: 1 | -1 };
export function CookieTable({
  cookies,
  selected,
  focused,
  protectedKeys,
  onSelect,
  onSelectAll,
  onFocus,
  sort,
  onSort,
  showValues,
  onCopy,
}: {
  cookies: CookieRecord[];
  selected: Set<string>;
  focused?: string;
  protectedKeys: Set<string>;
  onSelect: (key: string) => void;
  onSelectAll: () => void;
  onFocus: (cookie: CookieRecord) => void;
  sort: Sort;
  onSort: (field: Sort['field']) => void;
  showValues: boolean;
  onCopy: (cookie: CookieRecord) => void;
}) {
  const selectAll = useRef<HTMLInputElement>(null);
  const selectedCount = cookies.filter((cookie) => selected.has(cookieKey(cookie))).length;
  useEffect(() => {
    if (selectAll.current)
      selectAll.current.indeterminate = selectedCount > 0 && selectedCount < cookies.length;
  }, [selectedCount, cookies.length]);
  function heading(field: Sort['field'], label: string, className?: string) {
    return (
      <th
        className={className}
        scope="col"
        aria-sort={
          sort.field === field ? (sort.direction === 1 ? 'ascending' : 'descending') : 'none'
        }
      >
        <button onClick={() => onSort(field)}>
          {label}
          {sort.field === field &&
            (sort.direction === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
        </button>
      </th>
    );
  }
  return (
    <div className="table-scroll">
      <table className="cookie-table">
        <thead>
          <tr>
            <th className="check-cell" scope="col">
              <input
                ref={selectAll}
                type="checkbox"
                aria-label="Select all visible cookies"
                checked={cookies.length > 0 && selectedCount === cookies.length}
                onChange={onSelectAll}
              />
            </th>
            {heading('name', 'Name', 'name-column')}
            <th className="value-column" scope="col">
              Value
            </th>
            {heading('domain', 'Domain', 'domain-column')}
            <th className="path-column" scope="col">
              Path
            </th>
            {heading('expirationDate', 'Expires', 'expiry-column')}
            <th className="security-column" scope="col">
              <span className="sr-only">Security</span>
            </th>
            <th className="action-column" scope="col">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {cookies.map((cookie) => {
            const key = cookieKey(cookie);
            const label = cookie.name || '(unnamed)';
            const scope = [
              cookie.path,
              cookie.storeId,
              cookie.hostOnly ? 'host only' : 'domain cookie',
              cookie.firstPartyDomain ? `first party ${cookie.firstPartyDomain}` : '',
              cookie.partitionKey
                ? `partition ${cookie.partitionKey.topLevelSite || 'opaque'}${cookie.partitionKey.hasCrossSiteAncestor === undefined ? '' : `, cross-site ancestor ${cookie.partitionKey.hasCrossSiteAncestor ? 'yes' : 'no'}`}`
                : '',
            ]
              .filter(Boolean)
              .join(' · ');
            const ambiguous = cookies.some(
              (other) =>
                other !== cookie && other.name === cookie.name && other.domain === cookie.domain,
            );
            return (
              <tr key={key} className={focused === key ? 'focused' : ''}>
                <td className="check-cell">
                  <input
                    type="checkbox"
                    aria-label={`Select ${cookie.name || 'unnamed cookie'} on ${cookie.domain}${ambiguous ? ` · ${scope}` : ''}`}
                    checked={selected.has(key)}
                    onChange={() => onSelect(key)}
                  />
                </td>
                <td className="name-column">
                  <button
                    className="cookie-name"
                    title={`${label} · ${scope}`}
                    onClick={() => onFocus(cookie)}
                  >
                    {protectedKeys.has(key) && <ShieldCheck size={13} className="teal" />}
                    <span>{label}</span>
                  </button>
                  {cookie.path !== '/' && <span className="row-path">{cookie.path}</span>}
                </td>
                <td className="value-column">
                  <span
                    className={`cell-truncate mono ${showValues ? '' : 'masked-value'}`}
                    title={showValues ? cookie.value : 'Hidden value'}
                  >
                    {showValues ? cookie.value || '(empty)' : cookie.value ? '••••••••' : '(empty)'}
                  </span>
                </td>
                <td className="domain-column">
                  <span className="cell-truncate" title={`${cookie.domain} · ${scope}`}>
                    {cookie.domain}
                  </span>
                  {cookie.partitionKey && (
                    <span className="partition-note" title={scope}>
                      <Layers size={10} />
                      <span className="cell-truncate">
                        {cookie.partitionKey.topLevelSite || 'Opaque partition'}
                      </span>
                    </span>
                  )}
                  {cookie.firstPartyDomain && (
                    <span className="partition-note cell-truncate" title={scope}>
                      {cookie.firstPartyDomain}
                    </span>
                  )}
                </td>
                <td className="path-column mono">
                  <span className="cell-truncate" title={cookie.path}>
                    {cookie.path}
                  </span>
                </td>
                <td className="expiry-column expiry">
                  {expiryLabel(cookie.session, cookie.expirationDate)}
                </td>
                <td className="security-column">
                  <div className="security-flags">
                    {cookie.secure && (
                      <span title="Secure: HTTPS only">
                        <LockKeyhole size={13} />
                      </span>
                    )}
                    {cookie.httpOnly && (
                      <span title="HttpOnly: inaccessible to page scripts">
                        <KeyRound size={13} />
                      </span>
                    )}
                  </div>
                </td>
                <td className="action-column">
                  <button
                    className="icon-button row-copy"
                    title="Copy value"
                    aria-label={`Copy value of ${label} on ${cookie.domain} · ${scope}`}
                    onClick={() => onCopy(cookie)}
                  >
                    <Copy size={14} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
