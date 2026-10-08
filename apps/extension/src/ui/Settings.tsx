import { useState } from 'react';
import { ExternalLink, ShieldCheck, Trash2 } from 'lucide-react';
import { useWorkspace } from './context';
import { ErrorNotice, hostOf, Modal } from './shared';

export function Settings() {
  const { preferences, updatePreferences, gateway, currentTab, status, notify } = useWorkspace();
  const [confirm, setConfirm] = useState<'startup' | 'storage' | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function apply() {
    setBusy(true);
    setError('');
    try {
      if (confirm === 'startup') {
        await updatePreferences({ cleanOnStartup: true });
        notify('Startup cleanup enabled.');
      } else {
        await gateway.clearCurrentTabLocalStorage();
        notify('Local storage cleared for the current page.');
      }
      setConfirm(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not complete this action.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="settings-page">
      <header className="page-heading">
        <h1>Settings</h1>
      </header>
      <section className="settings-section">
        <h2>Appearance</h2>
        <div className="theme-choices">
          {(['system', 'light', 'dark'] as const).map((theme) => (
            <button
              key={theme}
              aria-pressed={preferences.theme === theme}
              className={`button ${preferences.theme === theme ? 'selected' : ''}`}
              onClick={() => {
                void updatePreferences({ theme }).catch(() => notify('Could not save appearance.'));
              }}
            >
              {theme.slice(0, 1).toUpperCase() + theme.slice(1)}
            </button>
          ))}
        </div>
      </section>
      <section className="settings-section">
        <h2>Cleanup</h2>
        <div className="setting-row">
          <div>
            <h3>Clear cookies on startup</h3>
            <p>Deletes unprotected cookies across all stores. May sign you out.</p>
          </div>
          <label className="toggle-label">
            <span className="sr-only">Clear cookies on startup</span>
            <input
              className="switch"
              type="checkbox"
              checked={preferences.cleanOnStartup}
              disabled={!status?.hostAccess}
              onChange={(event) => {
                if (event.target.checked) setConfirm('startup');
                else
                  void updatePreferences({ cleanOnStartup: false }).catch(() =>
                    notify('Could not update startup cleanup.'),
                  );
              }}
            />
          </label>
        </div>
        <div className="setting-row">
          <div>
            <h3>Current page’s local storage</h3>
            <p>
              {hostOf(currentTab?.url)
                ? `${hostOf(currentTab?.url)} · Local storage only; cookies are kept.`
                : 'Open Cookie Loom from a website to clear its local storage.'}
            </p>
          </div>
          <button
            className="button danger"
            disabled={!hostOf(currentTab?.url) || gateway.kind === 'demo'}
            onClick={() => setConfirm('storage')}
          >
            <Trash2 size={16} />
            Clear
          </button>
        </div>
      </section>
      <section className="settings-section">
        <h2>Privacy & permissions</h2>
        <p>
          <ShieldCheck className="inline-icon" size={17} /> No telemetry or cloud sync. Cookie
          values stay in your browser.
        </p>
        <p>
          Browser access: <strong>{status?.hostAccess ? 'Connected' : 'Not connected'}</strong>. To
          revoke access, use your browser’s extension settings.
        </p>
        <details className="settings-reference">
          <summary>What protection covers</summary>
          <p>
            Protection applies to Cookie Loom cleanup. Websites and browser settings can still
            remove cookies.
          </p>
        </details>
        <a
          className="text-link"
          href="https://github.com/q1/cookie-quick-manager/blob/fpi/PRIVACY.md"
          target="_blank"
          rel="noreferrer"
        >
          Privacy policy <ExternalLink size={14} />
        </a>
      </section>
      <section className="settings-section">
        <h2>About</h2>
        <p>
          Cookie Loom 0.1.0 · GPL-3.0-or-later. An independent rewrite of Cookie Quick Manager by
          Ysard.
        </p>
        <div className="about-links">
          <a
            className="text-link"
            href="https://github.com/q1/cookie-quick-manager"
            target="_blank"
            rel="noreferrer"
          >
            Source & contributions <ExternalLink size={14} />
          </a>
          <a
            className="text-link"
            href="https://github.com/q1/cookie-quick-manager/issues"
            target="_blank"
            rel="noreferrer"
          >
            Report an issue <ExternalLink size={14} />
          </a>
        </div>
      </section>
      {confirm && (
        <Modal
          title={confirm === 'startup' ? 'Enable startup cleanup?' : 'Clear local storage?'}
          onClose={() => {
            if (!busy) {
              setConfirm(null);
              setError('');
            }
          }}
        >
          <p>
            {confirm === 'startup'
              ? 'At each browser startup, delete unprotected cookies from all accessible stores, including containers. This may sign you out and cannot be undone.'
              : `Clear local storage for ${hostOf(currentTab?.url)}? This may reset preferences or sign you out and cannot be undone.`}
          </p>
          {error && <ErrorNotice>{error}</ErrorNotice>}
          <div className="modal-actions">
            <button className="button" disabled={busy} onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button className="button danger-solid" disabled={busy} onClick={() => void apply()}>
              {busy
                ? 'Working…'
                : confirm === 'startup'
                  ? 'Enable startup cleanup'
                  : 'Clear local storage'}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
