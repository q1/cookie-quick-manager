import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  cookieKey,
  filterCookies,
  groupCookiesByDomain,
  type CookieRecord,
} from '@cookie-loom/core';
import {
  Download,
  Upload,
  Plus,
  Search,
  RefreshCw,
  Trash2,
  ShieldCheck,
  ShieldOff,
  Undo2,
  Keyboard,
  Cookie,
  ArrowUpRight,
  X,
  Copy,
  Eye,
  EyeOff,
  Globe2,
} from 'lucide-react';
import { useWorkspace } from './context';
import { Sidebar, type View } from './Sidebar';
import { Connect, copyText, ErrorNotice, hostOf, Modal } from './shared';
import { CookieTable, type Sort } from './CookieTable';
import { CookieEditor } from './Editor';
import { TransferDialog } from './TransferDialog';
import { Settings } from './Settings';
import { CopyDialog } from './CopyDialog';

export function Workbench({ initialView = 'cookies' }: { initialView?: View }) {
  const {
    cookies,
    stores,
    preferences,
    gateway,
    status,
    loading,
    error,
    refresh,
    protect,
    notify,
    currentTab,
  } = useWorkspace();
  const [view, setView] = useState<View>(initialView);
  const [domain, setDomain] = useState('');
  const [query, setQuery] = useState('');
  const [store, setStore] = useState('');
  const [siteOnly, setSiteOnly] = useState(false);
  const [sort, setSort] = useState<Sort>({ field: 'domain', direction: 1 });
  const [focused, setFocused] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editorVersion, setEditorVersion] = useState(0);
  const focusedCookie = useRef<CookieRecord | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [transfer, setTransfer] = useState<'import' | 'export' | null>(null);
  const [deleting, setDeleting] = useState<CookieRecord[] | null>(null);
  const [copying, setCopying] = useState<CookieRecord[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [undo, setUndo] = useState<CookieRecord[]>([]);
  const [help, setHelp] = useState(false);
  const [showValues, setShowValues] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<(() => void) | null>(null);
  const editorDirty = useRef(false);
  const onEditorDirty = useCallback((dirty: boolean) => {
    editorDirty.current = dirty;
  }, []);
  const search = useRef<HTMLInputElement>(null);
  const demoOpened = useRef(false);
  const protectedKeys = useMemo(
    () => new Set(preferences.protectedKeys),
    [preferences.protectedKeys],
  );
  const domainGroups = useMemo(() => groupCookiesByDomain(cookies), [cookies]);
  const visible = useMemo(
    () =>
      filterCookies(cookies, query, {
        storeId: store || undefined,
        domain: siteOnly ? hostOf(currentTab?.url) : undefined,
      })
        .filter(
          (cookie) =>
            (!domain || cookie.domain.replace(/^\./, '') === domain) &&
            (view !== 'protected' || protectedKeys.has(cookieKey(cookie))),
        )
        .sort((a, b) => {
          const left =
            sort.field === 'domain' ? a.domain.replace(/^\./, '') : (a[sort.field] ?? Infinity);
          const right =
            sort.field === 'domain' ? b.domain.replace(/^\./, '') : (b[sort.field] ?? Infinity);
          return (
            sort.direction *
            (typeof left === 'number' && typeof right === 'number'
              ? left - right
              : String(left).localeCompare(String(right)))
          );
        }),
    [cookies, query, store, siteOnly, currentTab?.url, domain, view, protectedKeys, sort],
  );
  const pageCookies = visible.slice(page * 100, (page + 1) * 100);
  const chosen = visible.filter((cookie) => selected.has(cookieKey(cookie)));
  const original = focused
    ? (cookies.find((cookie) => cookieKey(cookie) === focused) ??
      focusedCookie.current ??
      undefined)
    : undefined;
  const cookieSeed = useMemo(
    (): CookieRecord => ({
      name: '',
      value: '',
      domain: domain || hostOf(currentTab?.url) || '',
      path: '/',
      secure: true,
      httpOnly: false,
      hostOnly: true,
      session: true,
      sameSite: 'lax',
      storeId: store || stores[0]?.id || '',
    }),
    [domain, currentTab?.url, store, stores],
  );
  useEffect(() => {
    if (gateway.kind === 'demo' && cookies.length && !demoOpened.current) {
      demoOpened.current = true;
      if (window.matchMedia('(max-width: 1180px)').matches) return;
      const first = cookies.find((cookie) => cookie.name === 'session_id') ?? cookies[0];
      if (first) {
        focusedCookie.current = first;
        setFocused(cookieKey(first));
      }
    }
  }, [cookies, gateway.kind]);
  function resetSelection() {
    setPage(0);
    setSelected(new Set());
  }
  function navigate(action: () => void) {
    if (editorDirty.current) setPendingNavigation(() => action);
    else action();
  }
  function closeEditor() {
    setFocused(null);
    setCreating(false);
  }
  function newCookie() {
    navigate(() => {
      setFocused(null);
      setEditorVersion((version) => version + 1);
      setCreating(true);
    });
  }
  function changeQuery(value: string) {
    setQuery(value);
    resetSelection();
  }
  function changeStore(value: string) {
    navigate(() => {
      closeEditor();
      setStore(value);
      resetSelection();
    });
  }
  function changeDomain(value: string) {
    navigate(() => {
      closeEditor();
      setDomain(value);
      resetSelection();
    });
  }
  function changeView(value: View, nextDomain = '') {
    navigate(() => {
      closeEditor();
      setView(value);
      setDomain(nextDomain);
      resetSelection();
    });
  }
  function changeSiteOnly(value: boolean) {
    setSiteOnly(value);
    resetSelection();
  }
  useEffect(() => {
    if (page > 0 && page * 100 >= visible.length) setPage(0);
  }, [page, visible.length]);
  useEffect(() => {
    if (!undo.length) return;
    const timer = setTimeout(() => setUndo([]), 300000);
    return () => clearTimeout(timer);
  }, [undo]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        event.defaultPrevented ||
        document.querySelector('dialog[open]') ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
      )
        return;
      if (
        event.key === '/' ||
        ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k')
      ) {
        event.preventDefault();
        search.current?.focus();
      }
      if (event.key === '?') setHelp(true);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);
  async function remove() {
    if (!deleting) return;
    setBusy(true);
    try {
      const result = await gateway.deleteCookies(deleting);
      if (result.deleted.some((cookie) => cookieKey(cookie) === focused)) closeEditor();
      setUndo(result.deleted);
      setSelected(new Set());
      setDeleting(null);
      await refresh();
      notify(
        `${result.deleted.length} deleted · ${result.protected.length} protected · ${result.failed.length} failed.`,
      );
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : 'Could not delete cookies.');
    } finally {
      setBusy(false);
    }
  }
  async function restore() {
    setBusy(true);
    let restored = 0;
    let skipped = 0;
    try {
      const live = new Set((await gateway.listCookies()).map(cookieKey));
      for (const cookie of undo) {
        if (live.has(cookieKey(cookie))) {
          skipped++;
          continue;
        }
        try {
          await gateway.saveCookie(cookie);
          restored++;
        } catch {
          skipped++;
        }
      }
      setUndo([]);
      await refresh();
      notify(`${restored} restored · ${skipped} skipped. Existing cookies were kept.`);
    } catch {
      notify('Could not restore cookies. Try again.');
    } finally {
      setBusy(false);
    }
  }
  const showEditor = Boolean(original || creating);
  const domainCount = new Set(visible.map((cookie) => cookie.domain.replace(/^\./, ''))).size;
  return (
    <div className={`app-shell ${showEditor ? 'has-inspector' : ''}`}>
      <Sidebar view={view} domain={domain} onNavigate={changeView} />
      <main className="main-workspace">
        {view === 'settings' ? (
          <Settings />
        ) : (
          <>
            <header className="workbench-header">
              <div className="page-heading">
                <h1>{view === 'protected' ? 'Protected' : 'Cookies'}</h1>
                <span className="heading-count" aria-label={`${visible.length} cookies`}>
                  {visible.length}
                </span>
              </div>
              <div className="header-actions">
                <button
                  className="button"
                  disabled={!status?.hostAccess}
                  onClick={() => setTransfer('import')}
                >
                  <Upload size={17} />
                  Import
                </button>
                <button
                  className="button"
                  disabled={!visible.length}
                  onClick={() => setTransfer('export')}
                >
                  <Download size={17} />
                  Export
                </button>
                <button
                  className="button primary"
                  disabled={!status?.hostAccess}
                  onClick={newCookie}
                >
                  <Plus size={18} />
                  New cookie
                </button>
              </div>
            </header>
            {error && (
              <ErrorNotice>
                {error}{' '}
                <button className="text-button" onClick={() => void refresh()}>
                  Try again
                </button>
              </ErrorNotice>
            )}
            {loading ? (
              <div className="empty-state" role="status">
                <RefreshCw className="spin" size={25} />
                <h2>Loading cookies…</h2>
              </div>
            ) : !status?.hostAccess ? (
              <Connect />
            ) : (
              <div className={`workspace-columns ${showEditor ? 'with-editor' : ''}`}>
                <section className="cookie-list" aria-label="Cookie workspace">
                  <div className="filter-row">
                    <div className="search-control">
                      <Search size={20} />
                      <input
                        ref={search}
                        aria-label="Search cookies"
                        value={query}
                        onChange={(event) => changeQuery(event.target.value)}
                        placeholder="Search cookies…"
                        spellCheck={false}
                      />
                      {query && (
                        <button
                          className="icon-button"
                          aria-label="Clear search"
                          onClick={() => changeQuery('')}
                        >
                          <X size={15} />
                        </button>
                      )}
                      {!query && <kbd aria-hidden="true">/</kbd>}
                    </div>
                    <select
                      aria-label="Filter by store"
                      value={store}
                      onChange={(event) => changeStore(event.target.value)}
                    >
                      <option value="">All stores</option>
                      {stores.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                    <select
                      className="domain-select"
                      aria-label="Filter by domain"
                      value={domain}
                      onChange={(event) => changeDomain(event.target.value)}
                    >
                      <option value="">All domains</option>
                      {domainGroups.map((group) => (
                        <option key={group.domain} value={group.domain}>
                          {group.domain}
                        </option>
                      ))}
                    </select>
                    {hostOf(currentTab?.url) && (
                      <button
                        className={`button site-filter ${siteOnly ? 'selected' : ''}`}
                        aria-pressed={siteOnly}
                        aria-label={`Current site: ${hostOf(currentTab?.url)}`}
                        onClick={() => changeSiteOnly(!siteOnly)}
                        title="Filter to the current site"
                      >
                        <Globe2 size={15} />
                        <span>{hostOf(currentTab?.url)}</span>
                      </button>
                    )}
                    <div className="toolbar-utilities">
                      <button
                        className="icon-button bordered"
                        aria-label="Refresh cookies"
                        title="Refresh cookies"
                        onClick={() => void refresh()}
                      >
                        <RefreshCw size={16} />
                      </button>
                      <button
                        className="icon-button bordered value-visibility"
                        aria-label={showValues ? 'Hide values' : 'Show values'}
                        title={showValues ? 'Hide values' : 'Show values'}
                        aria-pressed={showValues}
                        onClick={() => setShowValues(!showValues)}
                      >
                        {showValues ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                      <button
                        className="icon-button bordered danger-text"
                        aria-label="Clear unprotected"
                        title="Clear unprotected cookies in this view"
                        disabled={!visible.some((cookie) => !protectedKeys.has(cookieKey(cookie)))}
                        onClick={() =>
                          setDeleting(
                            visible.filter((cookie) => !protectedKeys.has(cookieKey(cookie))),
                          )
                        }
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                  {chosen.length > 0 && (
                    <div className="selection-bar">
                      <span>{chosen.length} selected</span>
                      <button
                        className="icon-button"
                        aria-label="Clear selection"
                        title="Clear selection"
                        onClick={() => setSelected(new Set())}
                      >
                        <X size={14} />
                      </button>
                      <button
                        className="text-button"
                        disabled={stores.length < 2}
                        onClick={() => setCopying(chosen)}
                      >
                        <Copy size={16} />
                        Copy to store
                      </button>
                      <button
                        className="text-button"
                        onClick={() => {
                          void protect(chosen, true)
                            .then(() => notify('Selected cookies protected.'))
                            .catch(() => notify('Could not protect cookies.'));
                        }}
                      >
                        <ShieldCheck size={16} />
                        Protect
                      </button>
                      <button
                        className="text-button"
                        onClick={() => {
                          void protect(chosen, false)
                            .then(() => notify('Protection removed.'))
                            .catch(() => notify('Could not update protection.'));
                        }}
                      >
                        <ShieldOff size={16} />
                        Unprotect
                      </button>
                      <button
                        className="text-button danger-text"
                        onClick={() => setDeleting(chosen)}
                      >
                        <Trash2 size={16} />
                        Delete
                      </button>
                    </div>
                  )}
                  {visible.length ? (
                    <CookieTable
                      cookies={pageCookies}
                      selected={selected}
                      focused={focused ?? undefined}
                      protectedKeys={protectedKeys}
                      showValues={showValues}
                      onCopy={(cookie) => {
                        void copyText(cookie.value)
                          .then(() => notify('Value copied.'))
                          .catch(() => notify('Could not copy value.'));
                      }}
                      onSelect={(key) =>
                        setSelected((previous) => {
                          const next = new Set(previous);
                          next.has(key) ? next.delete(key) : next.add(key);
                          return next;
                        })
                      }
                      onSelectAll={() =>
                        setSelected((previous) => {
                          const next = new Set(previous);
                          const all = pageCookies.every((cookie) => next.has(cookieKey(cookie)));
                          pageCookies.forEach((cookie) =>
                            all ? next.delete(cookieKey(cookie)) : next.add(cookieKey(cookie)),
                          );
                          return next;
                        })
                      }
                      onFocus={(cookie) => {
                        if (!creating && focused === cookieKey(cookie)) return;
                        navigate(() => {
                          focusedCookie.current = cookie;
                          setCreating(false);
                          setFocused(cookieKey(cookie));
                        });
                      }}
                      sort={sort}
                      onSort={(field) =>
                        setSort((previous) => ({
                          field,
                          direction: previous.field === field && previous.direction === 1 ? -1 : 1,
                        }))
                      }
                    />
                  ) : (
                    <div className="empty-state">
                      <Cookie size={32} />
                      <h2>{cookies.length ? 'No matching cookies' : 'No cookies yet'}</h2>
                      <p>
                        {cookies.length
                          ? 'Try another search, domain, or store.'
                          : 'Cookies will appear here as you browse.'}
                      </p>
                      {(query || domain || store || siteOnly) && (
                        <button
                          className="button"
                          onClick={() =>
                            navigate(() => {
                              closeEditor();
                              setQuery('');
                              setDomain('');
                              setStore('');
                              setSiteOnly(false);
                              resetSelection();
                            })
                          }
                        >
                          Reset filters
                        </button>
                      )}
                    </div>
                  )}
                  {visible.length > 100 && (
                    <div className="pagination">
                      <button
                        className="button"
                        disabled={page === 0}
                        onClick={() => setPage(page - 1)}
                      >
                        Previous
                      </button>
                      <span>
                        Page {page + 1} of {Math.ceil(visible.length / 100)}
                      </span>
                      <button
                        className="button"
                        disabled={(page + 1) * 100 >= visible.length}
                        onClick={() => setPage(page + 1)}
                      >
                        Next
                      </button>
                    </div>
                  )}
                  {undo.length > 0 && (
                    <div className="undo-bar" role="status">
                      <span>{undo.length} cookies deleted</span>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => void restore()}
                      >
                        <Undo2 size={16} />
                        Undo
                      </button>
                    </div>
                  )}
                  <footer className="list-footer">
                    <p>
                      {visible.length} {visible.length === 1 ? 'cookie' : 'cookies'} · {domainCount}{' '}
                      {domainCount === 1 ? 'domain' : 'domains'}
                    </p>
                    <button
                      className="text-button"
                      aria-label="Search help"
                      onClick={() => setHelp(true)}
                    >
                      <Keyboard size={17} />
                      <span>Keyboard shortcuts</span>
                    </button>
                  </footer>
                </section>
                {showEditor && (
                  <CookieEditor
                    key={original ? cookieKey(original) : `new-${editorVersion}`}
                    original={original}
                    seed={original ?? cookieSeed}
                    onClose={() => {
                      setFocused(null);
                      setCreating(false);
                    }}
                    onSaved={(cookie) => {
                      focusedCookie.current = cookie;
                      setCreating(false);
                      setFocused(cookieKey(cookie));
                      void refresh();
                    }}
                    onDelete={setDeleting}
                    onDirtyChange={onEditorDirty}
                  />
                )}
              </div>
            )}
          </>
        )}
      </main>
      {transfer && (
        <TransferDialog
          mode={transfer}
          cookies={chosen.length ? chosen : visible}
          onClose={() => setTransfer(null)}
        />
      )}
      {copying && <CopyDialog cookies={copying} onClose={() => setCopying(null)} />}
      {pendingNavigation && (
        <Modal title="Discard changes?" onClose={() => setPendingNavigation(null)}>
          <p>Your unsaved cookie edits will be lost.</p>
          <div className="modal-actions">
            <button className="button" onClick={() => setPendingNavigation(null)}>
              Keep editing
            </button>
            <button
              className="button danger-solid"
              onClick={() => {
                const action = pendingNavigation;
                editorDirty.current = false;
                setPendingNavigation(null);
                action();
              }}
            >
              Discard changes
            </button>
          </div>
        </Modal>
      )}
      {deleting && (
        <Modal
          title="Delete cookies?"
          onClose={() => {
            if (!busy) setDeleting(null);
          }}
        >
          <p>
            Delete {deleting.filter((cookie) => !protectedKeys.has(cookieKey(cookie))).length}{' '}
            unprotected cookies? This may sign you out of websites.{' '}
            {deleting.filter((cookie) => protectedKeys.has(cookieKey(cookie))).length > 0 &&
              'Protected cookies will be skipped.'}
          </p>
          <p className="small muted">
            Undo is available for 5 minutes while this tab stays open. It will not replace cookies a
            site has recreated.
          </p>
          <div className="modal-actions">
            <button className="button" disabled={busy} onClick={() => setDeleting(null)}>
              Cancel
            </button>
            <button
              className="button danger-solid"
              disabled={busy || !deleting.some((cookie) => !protectedKeys.has(cookieKey(cookie)))}
              onClick={() => void remove()}
            >
              {busy ? 'Deleting…' : 'Delete cookies'}
            </button>
          </div>
        </Modal>
      )}
      {help && (
        <Modal title="Search & shortcuts" onClose={() => setHelp(false)}>
          <p>Search names, domains, values, and paths. Combine terms to narrow the results.</p>
          <dl className="search-help">
            <dt>
              <code>domain:example.com</code>
            </dt>
            <dd>Match a domain</dd>
            <dt>
              <code>name:session -is:secure</code>
            </dt>
            <dd>Session-named cookies without Secure</dd>
            <dt>
              <code>value:"dark mode"</code>
            </dt>
            <dd>Search an exact phrase</dd>
            <dt>
              <code>is:partitioned</code>
            </dt>
            <dd>Inspect partitioned cookies</dd>
            <dt>
              <code>store:firefox-container-1</code>
            </dt>
            <dd>Match a store identifier</dd>
          </dl>
          <p className="small muted">
            <kbd>/</kbd> or <kbd>⌘/Ctrl K</kbd> focuses search. <kbd>?</kbd> opens this help.{' '}
            <kbd>Esc</kbd> closes the editor.
          </p>
          <a
            className="text-link"
            href="https://github.com/q1/cookie-quick-manager"
            target="_blank"
            rel="noreferrer"
          >
            Project documentation <ArrowUpRight size={14} />
          </a>
        </Modal>
      )}
    </div>
  );
}
