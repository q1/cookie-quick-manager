import { useState } from 'react';
import { cookieKey, filterCookies } from '@cookie-loom/core';
import {
  ArrowUpRight,
  Globe2,
  ShieldCheck,
  Trash2,
  LockKeyhole,
  Settings as SettingsIcon,
} from 'lucide-react';
import { useWorkspace } from './context';
import { Brand, Connect, ErrorNotice, hostOf, IconButton, Modal } from './shared';

export function Popup() {
  const {
    gateway,
    cookies,
    currentTab,
    preferences,
    status,
    loading,
    error,
    refresh,
    protect,
    notify,
  } = useWorkspace();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const host = hostOf(currentTab?.url);
  const siteCookies = host
    ? filterCookies(cookies, '', { domain: host, storeId: currentTab?.storeId })
    : [];
  const protectedKeys = new Set(preferences.protectedKeys);
  const unprotected = siteCookies.filter((cookie) => !protectedKeys.has(cookieKey(cookie)));
  async function clear() {
    setBusy(true);
    try {
      const result = await gateway.deleteCookies(unprotected);
      await refresh();
      setConfirm(false);
      notify(`${result.deleted.length} deleted · ${result.failed.length} failed.`);
    } catch {
      notify('Could not clear these cookies. Open the workspace to try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="popup-shell">
      <header className="popup-header">
        <Brand />
        <IconButton
          label="Open settings"
          onClick={() => {
            void gateway.openOptions().catch(() => notify('Could not open settings.'));
          }}
        >
          <SettingsIcon size={19} />
        </IconButton>
      </header>
      {loading ? (
        <p className="popup-loading" role="status">
          Loading cookies…
        </p>
      ) : !status?.hostAccess ? (
        <Connect />
      ) : (
        <>
          <section className="popup-site">
            <div className="site-icon">
              <Globe2 size={23} />
            </div>
            <div>
              <span className="small muted">This site</span>
              <h1>{host || 'No website selected'}</h1>
            </div>
          </section>
          {error && <ErrorNotice>{error}</ErrorNotice>}
          <div className="popup-summary">
            <strong>
              {siteCookies.length}
              <span>cookies</span>
            </strong>
            <strong>
              {siteCookies.filter((cookie) => protectedKeys.has(cookieKey(cookie))).length}
              <span>protected</span>
            </strong>
            <strong>
              {siteCookies.filter((cookie) => cookie.session).length}
              <span>session</span>
            </strong>
          </div>
          <section className="popup-cookie-list" aria-label="Site cookies">
            {siteCookies.slice(0, 5).map((cookie) => (
              <div key={cookieKey(cookie)}>
                <span className="cookie-name">
                  {protectedKeys.has(cookieKey(cookie)) ? (
                    <ShieldCheck size={15} className="teal" />
                  ) : (
                    <LockKeyhole size={15} />
                  )}
                  <span>{cookie.name || '(unnamed)'}</span>
                </span>
                <span className="small muted">{cookie.session ? 'Session' : 'Persistent'}</span>
              </div>
            ))}
            {siteCookies.length > 5 && (
              <p className="small muted">+ {siteCookies.length - 5} more</p>
            )}
            {siteCookies.length === 0 && (
              <p className="muted">
                {host ? 'No cookies in this store.' : 'Open an HTTP or HTTPS page.'}
              </p>
            )}
          </section>
          <div className="popup-actions">
            <button
              className="button full"
              disabled={!siteCookies.some((cookie) => cookie.session)}
              onClick={() => {
                void protect(
                  siteCookies.filter((cookie) => cookie.session),
                  true,
                )
                  .then(() => notify('Session cookies protected from cleanup.'))
                  .catch(() => notify('Could not protect cookies.'));
              }}
            >
              <ShieldCheck size={17} />
              Protect session cookies
            </button>
            <button
              className="button danger full"
              disabled={!unprotected.length}
              onClick={() => setConfirm(true)}
            >
              <Trash2 size={17} />
              Clear {unprotected.length} unprotected cookies
            </button>
            <button
              className="button primary full"
              onClick={() => {
                void gateway.openWorkbench().catch(() => notify('Could not open the workspace.'));
              }}
            >
              Open workbench
              <ArrowUpRight size={17} />
            </button>
          </div>
          {gateway.kind === 'demo' && <p className="popup-demo small muted">Demo · sample data</p>}
        </>
      )}
      {confirm && (
        <Modal
          title="Clear this site’s cookies?"
          onClose={() => {
            if (!busy) setConfirm(false);
          }}
        >
          <p>
            Delete {unprotected.length} unprotected cookies for {host}? This may sign you out.
            Protected cookies are kept.
          </p>
          <p className="small muted">This action cannot be undone.</p>
          <div className="modal-actions">
            <button className="button" disabled={busy} onClick={() => setConfirm(false)}>
              Cancel
            </button>
            <button className="button danger-solid" disabled={busy} onClick={() => void clear()}>
              {busy ? 'Clearing…' : 'Clear cookies'}
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}
