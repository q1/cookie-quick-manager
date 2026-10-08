import { useMemo, useRef, useState } from 'react';
import { cookieKey, type CookieRecord } from '@cookie-loom/core';
import { Copy, CheckCircle2 } from 'lucide-react';
import { useWorkspace } from './context';
import { ErrorNotice, Modal } from './shared';

function planCopies(
  sources: readonly CookieRecord[],
  current: readonly CookieRecord[],
  protectedKeys: readonly string[],
  destination: string,
) {
  const existing = new Set(current.map(cookieKey));
  const protectedSet = new Set(protectedKeys);
  const candidates = sources.map((source) => ({
    source,
    copy: { ...source, storeId: destination },
  }));
  const counts = new Map<string, number>();
  for (const { copy } of candidates) {
    const key = cookieKey(copy);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const ready = candidates
    .filter(({ source, copy }) => {
      const key = cookieKey(copy);
      return (
        source.storeId !== destination &&
        !existing.has(key) &&
        !protectedSet.has(key) &&
        counts.get(key) === 1
      );
    })
    .map(({ copy }) => copy);
  return { ready, skipped: sources.length - ready.length };
}

export function CopyDialog({ cookies, onClose }: { cookies: CookieRecord[]; onClose: () => void }) {
  const { gateway, stores, cookies: currentCookies, preferences, refresh, notify } = useWorkspace();
  const sourceIds = new Set(cookies.map((cookie) => cookie.storeId));
  const [destination, setDestination] = useState(
    () => stores.find((store) => !sourceIds.has(store.id))?.id ?? '',
  );
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState<{
    copied: number;
    skipped: number;
    failed: number;
  } | null>(null);
  const destinationStore = stores.find((store) => store.id === destination);
  const plan = useMemo(
    () => planCopies(cookies, currentCookies, preferences.protectedKeys, destination),
    [cookies, currentCookies, preferences.protectedKeys, destination],
  );
  const sourceNames = [...sourceIds]
    .map((id) => stores.find((store) => store.id === id)?.name ?? id)
    .join(', ');

  async function copy() {
    if (!destinationStore || !confirmed || running.current || !cookies.length) return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      // Recheck immediately before writes. saveCookie also rejects collisions created after this snapshot.
      const [live, latestPreferences] = await Promise.all([
        gateway.listCookies(),
        gateway.getPreferences(),
      ]);
      const checked = planCopies(cookies, live, latestPreferences.protectedKeys, destination);
      let copied = 0;
      let failed = 0;
      for (const candidate of checked.ready) {
        try {
          await gateway.saveCookie(candidate);
          copied++;
        } catch {
          failed++;
        }
      }
      setSummary({ copied, skipped: checked.skipped, failed });
      await refresh();
      notify(`${copied} copied · ${checked.skipped} skipped · ${failed} failed.`);
    } catch {
      setError(
        'Unable to check destination cookies. No cookies were copied. Refresh and try again.',
      );
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Copy cookies to a store"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      {summary ? (
        <>
          <div className="import-complete">
            <CheckCircle2 size={32} />
            <h3>Copy finished</h3>
            <p role="status">
              {summary.copied} copied · {summary.skipped} skipped · {summary.failed} failed.
            </p>
            <p className="small muted">Source cookies and their protection are unchanged.</p>
          </div>
          <div className="modal-actions">
            <button className="button primary" type="button" onClick={onClose}>
              Done
            </button>
          </div>
        </>
      ) : (
        <>
          <p>
            Copy {cookies.length} {cookies.length === 1 ? 'cookie' : 'cookies'} from{' '}
            {sourceNames || 'the current selection'}.
          </p>
          <div className="notice warning">
            Copying between stores shares those cookie values. A copied login may sign you in to the
            destination, including private or container contexts.
          </div>
          <label className="field">
            Destination store
            <select
              value={destination}
              disabled={busy}
              onChange={(event) => {
                setDestination(event.target.value);
                setConfirmed(false);
                setError('');
              }}
            >
              <option value="">Choose a destination store</option>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                  {store.incognito ? ' · private' : ''}
                  {sourceIds.has(store.id) ? ' · includes source cookies' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={!destinationStore || busy}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            I confirm {destinationStore?.name ?? 'the selected store'} is the destination.
          </label>
          <p className="small muted">
            Existing cookies, protected identities, and conflicting copies are skipped.
          </p>
          <p className="small muted">
            Sources stay unchanged. Copies preserve isolation and are not automatically protected.
          </p>
          {destinationStore ? (
            <p role="status">
              {plan.ready.length} ready to copy · {plan.skipped} will be skipped.
            </p>
          ) : null}
          {error ? <ErrorNotice>{error}</ErrorNotice> : null}
          <div className="modal-actions">
            <button className="button" type="button" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              className="button primary"
              type="button"
              disabled={!destinationStore || !confirmed || busy || !plan.ready.length}
              onClick={() => void copy()}
            >
              <Copy size={17} />
              {busy ? 'Copying…' : `Copy ${plan.ready.length} cookies`}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
