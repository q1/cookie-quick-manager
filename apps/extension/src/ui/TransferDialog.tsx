import { useMemo, useState, type ChangeEvent } from 'react';
import {
  cookieKey,
  exportNetscape,
  importCookies,
  serializeBackup,
  type CookieRecord,
  type ImportResult,
} from '@cookie-loom/core';
import { Upload, Download, CheckCircle2 } from 'lucide-react';
import { useWorkspace } from './context';
import { ErrorNotice, Modal } from './shared';

export function TransferDialog({
  mode,
  cookies,
  onClose,
}: {
  mode: 'import' | 'export';
  cookies: CookieRecord[];
  onClose: () => void;
}) {
  const { gateway, stores, refresh, notify } = useWorkspace();
  const [format, setFormat] = useState('json');
  const [text, setText] = useState('');
  const [target, setTarget] = useState(stores[0]?.id ?? '');
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [replace, setReplace] = useState(false);
  const [legacyNetscape, setLegacyNetscape] = useState(false);
  const [storeMode, setStoreMode] = useState<'preserve' | 'map'>('preserve');
  const [mappingAcknowledged, setMappingAcknowledged] = useState(false);
  const [summary, setSummary] = useState('');
  const exported = useMemo(() => {
    if (mode !== 'export') return { text: '', warnings: [] as string[], error: '' };
    try {
      return {
        ...(format === 'json'
          ? { text: serializeBackup(cookies, stores), warnings: [] }
          : exportNetscape(cookies)),
        error: '',
      };
    } catch (reason) {
      return {
        text: '',
        warnings: [] as string[],
        error:
          reason instanceof Error
            ? reason.message
            : 'This selection is too large to export. Filter it into smaller batches.',
      };
    }
  }, [cookies, stores, format, mode]);
  const destinations =
    preview?.cookies.map((cookie) =>
      storeMode === 'map' ? { ...cookie, storeId: target } : cookie,
    ) ?? [];
  const unknownStores = [
    ...new Set(
      destinations
        .filter((cookie) => !stores.some((store) => store.id === cookie.storeId))
        .map((cookie) => cookie.storeId),
    ),
  ];
  const collisionCount = destinations.length - new Set(destinations.map(cookieKey)).size;
  function review() {
    try {
      setPreview(
        importCookies(text, {
          storeId: target,
          netscapeMode: legacyNetscape ? 'legacy-cqm' : 'standard',
        }),
      );
      setError('');
    } catch (reason) {
      setPreview(null);
      setError(reason instanceof Error ? reason.message : 'Unable to read this backup.');
    }
  }
  async function readFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setPreview(null);
    if (file.size > 10 * 1024 * 1024) {
      setError('Choose a backup smaller than 10 MiB.');
      return;
    }
    try {
      setText(await file.text());
      setPreview(null);
      setError('');
    } catch {
      setError('This file could not be read.');
    }
  }
  async function restore() {
    if (!preview || !target || busy) return;
    setBusy(true);
    setError('');
    let saved = 0;
    let skipped = 0;
    let failed = 0;
    try {
      if (unknownStores.length || collisionCount || (storeMode === 'map' && !mappingAcknowledged))
        throw new Error('Resolve the destination store warnings before importing.');
      const current = new Map(
        (await gateway.listCookies()).map((cookie) => [cookieKey(cookie), cookie]),
      );
      const protectedKeys = new Set((await gateway.getPreferences()).protectedKeys);
      for (const cookie of destinations) {
        const key = cookieKey(cookie);
        const existing = current.get(key);
        if (protectedKeys.has(key) || (existing && !replace)) {
          skipped++;
          continue;
        }
        try {
          const result = await gateway.saveCookie(cookie, existing);
          current.set(cookieKey(result), result);
          saved++;
        } catch {
          failed++;
        }
      }
      setSummary(
        `${saved} imported · ${skipped} skipped · ${failed} failed${preview.errors.length ? ` · ${preview.errors.length} invalid rows excluded` : ''}.`,
      );
      await refresh();
      notify(`Import complete: ${saved} cookies saved.`);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Import interrupted. Refresh to review changes.',
      );
    } finally {
      setBusy(false);
    }
  }
  function download() {
    const blob = new Blob([exported.text], {
      type: format === 'json' ? 'application/json' : 'text/plain',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `cookie-loom-${new Date().toISOString().slice(0, 10)}.${format === 'json' ? 'json' : 'txt'}`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify(`Exported ${cookies.length} cookies.`);
  }
  return (
    <Modal
      title={mode === 'import' ? 'Import cookies' : 'Export cookies'}
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      {mode === 'export' ? (
        <>
          <p>
            {cookies.length} {cookies.length === 1 ? 'cookie' : 'cookies'} selected.
          </p>
          <div className="notice">
            Backups may grant access to your accounts. Keep them private.
          </div>
          <label className="field">
            File format
            <select value={format} onChange={(event) => setFormat(event.target.value)}>
              <option value="json">Cookie Loom JSON · full backup</option>
              <option value="netscape">Netscape text · some attributes lost</option>
            </select>
          </label>
          {exported.warnings.map((warning) => (
            <p className="notice warning" key={warning}>
              {warning}
            </p>
          ))}
          {exported.error && <ErrorNotice>{exported.error}</ErrorNotice>}
          <div className="modal-actions">
            <button className="button" onClick={onClose}>
              Cancel
            </button>
            <button
              className="button primary"
              onClick={download}
              disabled={!cookies.length || !!exported.error}
            >
              <Download size={17} />
              Download backup
            </button>
          </div>
        </>
      ) : summary ? (
        <>
          <div className="import-complete">
            <CheckCircle2 size={32} />
            <h3>Import finished</h3>
            <p role="status">{summary}</p>
          </div>
          <div className="modal-actions">
            <button className="button primary" onClick={onClose}>
              Done
            </button>
          </div>
        </>
      ) : (
        <>
          <p>Cookie Loom JSON, Cookie Quick Manager, or Netscape text.</p>
          <label className="field">
            Backup file
            <input
              type="file"
              accept=".json,.txt,application/json,text/plain"
              onChange={(event) => void readFile(event)}
              disabled={busy}
            />
          </label>
          <label className="field">
            Or paste contents
            <textarea
              rows={5}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setPreview(null);
              }}
              spellCheck={false}
              placeholder="Paste JSON or Netscape cookie data"
              disabled={busy}
            />
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={legacyNetscape}
              onChange={(event) => {
                setLegacyNetscape(event.target.checked);
                setPreview(null);
              }}
              disabled={busy}
            />
            Legacy Cookie Quick Manager Netscape export
          </label>
          <p className="small muted">
            Enable only for the old extension’s Netscape files to repair its reversed domain-scope
            flags.
          </p>
          <label className="field">
            Store handling
            <select
              value={storeMode}
              onChange={(event) => {
                setStoreMode(event.target.value as 'preserve' | 'map');
                setMappingAcknowledged(false);
              }}
              disabled={busy}
            >
              <option value="preserve">Preserve saved stores</option>
              <option value="map">Import into one store</option>
            </select>
            <span className="small muted">
              Saved stores keep private and container cookies separate. Netscape uses the fallback
              store.
            </span>
          </label>
          <label className="field">
            {storeMode === 'map' ? 'Destination store' : 'Fallback store'}
            <select
              value={target}
              onChange={(event) => {
                setTarget(event.target.value);
                setPreview(null);
              }}
              disabled={busy}
            >
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </label>
          {storeMode === 'map' && (
            <div className="notice warning">
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={mappingAcknowledged}
                  onChange={(event) => setMappingAcknowledged(event.target.checked)}
                  disabled={busy}
                />
                I understand private and container cookies will share the selected store.
              </label>
            </div>
          )}
          <label className="check-label">
            <input
              type="checkbox"
              checked={replace}
              onChange={(event) => setReplace(event.target.checked)}
              disabled={busy}
            />
            Replace matching cookies
          </label>
          <p className="small muted">Protected cookies are always skipped.</p>
          {preview && (
            <section className="import-preview" aria-label="Import preview">
              <h3>{preview.cookies.length} valid cookies</h3>
              <p className="small muted">
                Detected {preview.format} · {preview.errors.length} invalid rows
              </p>
              <ul className="preview-list">
                {preview.cookies.slice(0, 6).map((cookie, index) => (
                  <li key={index}>
                    <code>{cookie.name || '(unnamed)'}</code>
                    <span>{cookie.domain}</span>
                  </li>
                ))}
              </ul>
              {preview.cookies.length > 6 && (
                <p className="small muted">+ {preview.cookies.length - 6} more</p>
              )}
              {preview.warnings.map((warning) => (
                <p className="notice warning" key={warning}>
                  {warning}
                </p>
              ))}
              {unknownStores.length > 0 && (
                <ErrorNotice>
                  Unavailable stores: {unknownStores.join(', ')}. Recreate the original containers
                  or explicitly choose a destination store.
                </ErrorNotice>
              )}
              {collisionCount > 0 && (
                <ErrorNotice>
                  {collisionCount} cookies would share an identity in the destination. Split this
                  backup by source store before importing.
                </ErrorNotice>
              )}
              {preview.errors.length > 0 && (
                <details>
                  <summary>{preview.errors.length} invalid rows will not be imported</summary>
                  <ul>
                    {preview.errors.slice(0, 20).map((issue, index) => (
                      <li key={index}>
                        {issue.line ? `Line ${issue.line}` : `Row ${(issue.index ?? index) + 1}`}:{' '}
                        {issue.message}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </section>
          )}
          {error && <ErrorNotice>{error}</ErrorNotice>}
          <div className="modal-actions">
            <button className="button" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            {preview ? (
              <button
                className="button primary"
                disabled={
                  !preview.cookies.length ||
                  !target ||
                  busy ||
                  !!unknownStores.length ||
                  !!collisionCount ||
                  (storeMode === 'map' && !mappingAcknowledged)
                }
                onClick={() => void restore()}
              >
                <Upload size={17} />
                {busy ? 'Importing…' : `Import ${preview.cookies.length} cookies`}
              </button>
            ) : (
              <button
                className="button primary"
                disabled={!text.trim() || !target}
                onClick={review}
              >
                Review import
              </button>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
