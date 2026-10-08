import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { cookieKey, validateCookie, type CookieRecord } from '@cookie-loom/core';
import { X, Eye, EyeOff, Copy, Check, Trash2 } from 'lucide-react';
import { useWorkspace } from './context';
import { copyText, ErrorNotice, IconButton, Modal } from './shared';
import { ValueTools } from './ValueTools';

function fingerprint(cookie: CookieRecord): string {
  return JSON.stringify([
    cookie.name,
    cookie.value,
    cookie.domain,
    cookie.path,
    cookie.secure,
    cookie.httpOnly,
    cookie.hostOnly,
    cookie.session,
    cookie.expirationDate ?? null,
    cookie.sameSite,
    cookie.storeId,
    cookie.firstPartyDomain ?? null,
    cookie.partitionKey ?? null,
  ]);
}

function localDateValue(expirationDate?: number): string {
  if (expirationDate === undefined || !Number.isFinite(expirationDate)) return '';
  const date = new Date(expirationDate * 1000);
  if (!Number.isFinite(date.getTime()) || date.getFullYear() < 1000 || date.getFullYear() > 9999)
    return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function CookieEditor({
  original,
  seed,
  onClose,
  onSaved,
  onDelete,
  onDirtyChange,
  onSavingChange,
  missing = false,
}: {
  original?: CookieRecord;
  seed: CookieRecord;
  onClose: () => void;
  onSaved: (cookie: CookieRecord) => void;
  onDelete: (cookies: CookieRecord[]) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onSavingChange?: (saving: boolean) => void;
  missing?: boolean;
}) {
  const { gateway, stores, preferences, protect, notify } = useWorkspace();
  // A live refresh must not replace the version this draft was based on.
  const [baselineOriginal, setBaselineOriginal] = useState(() =>
    original ? structuredClone(original) : undefined,
  );
  const [baselineDraft, setBaselineDraft] = useState(() => structuredClone(seed));
  const [draft, setDraft] = useState(() => structuredClone(seed));
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [discardAction, setDiscardAction] = useState<(() => void) | null>(null);
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 1180px)').matches);
  const dialog = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const fieldPrefix = useId();
  const dirty = fingerprint(draft) !== fingerprint(baselineDraft);
  const changedInBrowser =
    !missing &&
    !!baselineOriginal &&
    !!original &&
    fingerprint(original) !== fingerprint(baselineOriginal);
  const protectedCookie = preferences.protectedKeys.includes(cookieKey(baselineOriginal ?? draft));
  const dateValue = localDateValue(draft.expirationDate);
  const issues = validateCookie(draft);
  if (
    !draft.session &&
    draft.expirationDate !== undefined &&
    !dateValue &&
    !issues.some((issue) => issue.field === 'expirationDate')
  ) {
    issues.push({
      field: 'expirationDate',
      message: 'Choose a date between years 1000 and 9999.',
      severity: 'error',
    });
  }

  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onSavingChange?.(false), [onSavingChange]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1180px)');
    const change = () => setCompact(media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    if (!compact) return;
    const modal = dialog.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modal?.showModal();
    return () => {
      modal?.close();
      opener?.focus();
    };
  }, [compact]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);
  useEffect(() => {
    if (!dirty) return;
    const preventUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', preventUnload);
    return () => window.removeEventListener('beforeunload', preventUnload);
  }, [dirty]);

  function requestAction(action: () => void) {
    if (submitting.current) return;
    if (dirty) setDiscardAction(() => action);
    else action();
  }
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const open = [...document.querySelectorAll('dialog[open]')];
      if (open.length && open[open.length - 1] !== dialog.current) return;
      event.preventDefault();
      event.stopPropagation();
      requestAction(onClose);
    };
    document.addEventListener('keydown', escape, true);
    return () => document.removeEventListener('keydown', escape, true);
  }, [dirty, onClose]);

  const patch = (value: Partial<CookieRecord>) => {
    setDraft((current) => ({ ...current, ...value }));
    setError('');
    setCopied(false);
  };
  function fieldAttributes(field: string) {
    const invalid = issues.some((issue) => issue.field === field && issue.severity === 'error');
    return {
      disabled: saving,
      'aria-invalid': invalid,
      'aria-describedby': invalid ? `${fieldPrefix}-${field}-error` : undefined,
    };
  }
  function fieldError(field: string) {
    const errors = issues.filter((issue) => issue.field === field && issue.severity === 'error');
    return errors.length ? (
      <span className="field-error" id={`${fieldPrefix}-${field}-error`}>
        {errors.map((issue) => issue.message).join(' ')}
      </span>
    ) : null;
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    if (missing) {
      setError('This cookie no longer exists. Close the editor to create a new cookie.');
      return;
    }
    if (issues.some((issue) => issue.severity === 'error')) {
      setError('Resolve the highlighted fields before saving.');
      return;
    }
    submitting.current = true;
    setSaving(true);
    onSavingChange?.(true);
    setError('');
    try {
      const saved = await gateway.saveCookie(draft, baselineOriginal);
      setDraft(saved);
      setBaselineDraft(structuredClone(saved));
      setBaselineOriginal(structuredClone(saved));
      onDirtyChange?.(false);
      onSaved(saved);
      notify(baselineOriginal ? 'Cookie updated.' : 'Cookie created.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save cookie.');
    } finally {
      submitting.current = false;
      setSaving(false);
      onSavingChange?.(false);
    }
  }
  function reload() {
    if (!original || missing) return;
    const current = structuredClone(original);
    setDraft(current);
    setBaselineDraft(current);
    setBaselineOriginal(current);
    setError('');
    setRevealed(false);
    setCopied(false);
  }
  const content = (
    <>
      <div className="inspector-heading">
        <h2 title={baselineOriginal?.name}>
          {baselineOriginal ? baselineOriginal.name || '(unnamed)' : 'New cookie'}
        </h2>
        <IconButton
          label="Close cookie details"
          onClick={() => requestAction(onClose)}
          disabled={saving}
        >
          <X size={18} />
        </IconButton>
      </div>
      <form onSubmit={(event) => void submit(event)} noValidate aria-busy={saving}>
        {missing && (
          <div className="notice warning editor-stale" role="status">
            This cookie no longer exists in the browser. Your draft is kept here; close the editor
            to choose or create another cookie.
          </div>
        )}
        {changedInBrowser && (
          <div className="notice warning editor-stale" role="status">
            <span>This cookie changed in the browser.</span>
            <button className="text-button" type="button" onClick={() => requestAction(reload)}>
              Reload cookie
            </button>
          </div>
        )}
        <label className="field">
          Name
          <input
            value={draft.name}
            onChange={(event) => patch({ name: event.target.value })}
            autoComplete="off"
            spellCheck={false}
            aria-label="Name"
            {...fieldAttributes('name')}
          />
          {fieldError('name')}
        </label>
        <div className="field">
          <label htmlFor={`${fieldPrefix}-value`}>Value</label>
          <div className="value-control">
            <input
              id={`${fieldPrefix}-value`}
              type={revealed ? 'text' : 'password'}
              value={draft.value}
              onChange={(event) => patch({ value: event.target.value })}
              autoComplete="new-password"
              spellCheck={false}
              aria-label="Value"
              {...fieldAttributes('value')}
            />
            <IconButton
              label={revealed ? 'Hide value' : 'Reveal value'}
              onClick={() => setRevealed(!revealed)}
            >
              {revealed ? <EyeOff size={16} /> : <Eye size={16} />}
            </IconButton>
            <IconButton
              label={copied ? 'Value copied' : 'Copy cookie value'}
              onClick={() => {
                void copyText(draft.value)
                  .then(() => {
                    setCopied(true);
                    notify('Value copied.');
                  })
                  .catch(() =>
                    notify('Clipboard unavailable. Reveal the value to select and copy it.'),
                  );
              }}
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
            </IconButton>
          </div>
          {fieldError('value')}
        </div>
        <div className="editor-field-grid">
          <label className="field">
            Domain
            <input
              value={draft.domain}
              onChange={(event) => patch({ domain: event.target.value })}
              placeholder="example.com"
              autoComplete="off"
              spellCheck={false}
              aria-label="Domain"
              {...fieldAttributes('domain')}
            />
            {fieldError('domain')}
          </label>
          <label className="field">
            Path
            <input
              value={draft.path}
              onChange={(event) => patch({ path: event.target.value })}
              autoComplete="off"
              spellCheck={false}
              aria-label="Path"
              {...fieldAttributes('path')}
            />
            {fieldError('path')}
          </label>
        </div>
        <div className="editor-field-grid">
          <label className="field">
            SameSite
            <select
              value={draft.sameSite}
              onChange={(event) =>
                patch({ sameSite: event.target.value as CookieRecord['sameSite'] })
              }
              aria-label="SameSite"
              {...fieldAttributes('sameSite')}
            >
              <option value="lax">Lax</option>
              <option value="strict">Strict</option>
              <option value="no_restriction">None · Secure required</option>
              <option value="unspecified">Unspecified</option>
            </select>
            {fieldError('sameSite')}
          </label>
          <label className="field">
            Lifetime
            <select
              value={draft.session ? 'session' : 'persistent'}
              onChange={(event) =>
                patch({
                  session: event.target.value === 'session',
                  expirationDate:
                    event.target.value === 'session'
                      ? undefined
                      : Math.floor(Date.now() / 1000) + 86400 * 30,
                })
              }
              aria-label="Lifetime"
              {...fieldAttributes('session')}
            >
              <option value="session">Session</option>
              <option value="persistent">Persistent</option>
            </select>
            {fieldError('session')}
          </label>
        </div>
        {!draft.session && (
          <label className="field">
            Expires at (local time)
            <input
              type="datetime-local"
              value={dateValue}
              required
              onChange={(event) =>
                patch({
                  expirationDate: event.target.value
                    ? new Date(event.target.value).getTime() / 1000
                    : undefined,
                })
              }
              aria-label="Expires at (local time)"
              {...fieldAttributes('expirationDate')}
            />
            {fieldError('expirationDate')}
          </label>
        )}
        <div className="check-row editor-flags">
          <label>
            <input
              type="checkbox"
              checked={draft.secure}
              onChange={(event) => patch({ secure: event.target.checked })}
              {...fieldAttributes('secure')}
            />
            Secure
          </label>
          <label>
            <input
              type="checkbox"
              checked={draft.httpOnly}
              onChange={(event) => patch({ httpOnly: event.target.checked })}
              {...fieldAttributes('httpOnly')}
            />
            HttpOnly
          </label>
          <label>
            <input
              type="checkbox"
              checked={draft.hostOnly}
              onChange={(event) => patch({ hostOnly: event.target.checked })}
              {...fieldAttributes('hostOnly')}
            />
            Host only
          </label>
        </div>
        {fieldError('secure')}
        {fieldError('httpOnly')}
        {fieldError('hostOnly')}
        <details className="advanced">
          <summary>Store & isolation</summary>
          <label className="field">
            Cookie store
            <select
              value={draft.storeId}
              onChange={(event) => patch({ storeId: event.target.value })}
              aria-label="Cookie store"
              {...fieldAttributes('storeId')}
            >
              {!stores.some((store) => store.id === draft.storeId) && (
                <option value={draft.storeId}>{draft.storeId || 'Choose a store'}</option>
              )}
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
            {fieldError('storeId')}
          </label>
          {draft.partitionKey && (
            <p className="small muted">
              Partition: <code>{draft.partitionKey.topLevelSite || '(opaque)'}</code>
              {draft.partitionKey.hasCrossSiteAncestor !== undefined
                ? ` · Cross-site ancestor: ${draft.partitionKey.hasCrossSiteAncestor ? 'yes' : 'no'}`
                : ''}
            </p>
          )}
          {fieldError('partitionKey')}
          {draft.firstPartyDomain && (
            <p className="small muted">
              First-party domain: <code>{draft.firstPartyDomain}</code>
            </p>
          )}
          {fieldError('firstPartyDomain')}
        </details>
        <fieldset
          disabled={saving}
          style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: 'contents' }}
        >
          <ValueTools value={draft.value} onChange={(value) => patch({ value })} />
        </fieldset>
        {baselineOriginal && (
          <div className="protection-setting">
            <label className="toggle-label">
              <input
                className="switch"
                type="checkbox"
                checked={protectedCookie}
                disabled={missing || saving}
                onChange={(event) => {
                  void protect([baselineOriginal], event.target.checked).catch(() =>
                    notify('Could not update protection.'),
                  );
                }}
              />
              <span>Protected from cleanup</span>
            </label>
          </div>
        )}
        {issues
          .filter((issue) => issue.severity === 'warning')
          .map((issue) => (
            <div className="notice small" key={issue.message}>
              {issue.message}
            </div>
          ))}
        {error && <ErrorNotice>{error}</ErrorNotice>}
        <div className="editor-actions inspector-actions">
          {baselineOriginal && (
            <button
              className="icon-button danger-text"
              type="button"
              aria-label="Delete cookie"
              onClick={() =>
                requestAction(() => {
                  setDraft(structuredClone(baselineDraft));
                  onDelete([baselineOriginal]);
                })
              }
              disabled={protectedCookie || saving || missing}
              title={
                protectedCookie ? 'Turn off protection to delete this cookie.' : 'Delete cookie'
              }
            >
              <Trash2 size={17} />
            </button>
          )}
          <button
            className="button primary"
            type="submit"
            disabled={saving || missing || (!!baselineOriginal && !dirty)}
          >
            {saving ? 'Saving…' : baselineOriginal ? 'Save changes' : 'Create cookie'}
          </button>
        </div>
      </form>
    </>
  );
  return (
    <>
      {compact ? (
        <dialog
          ref={dialog}
          className="inspector"
          aria-label={baselineOriginal ? 'Cookie details' : 'New cookie'}
          onCancel={(event) => {
            event.preventDefault();
            requestAction(onClose);
          }}
          onClick={(event) => {
            const bounds = event.currentTarget.getBoundingClientRect();
            if (
              event.target === event.currentTarget &&
              (event.clientX < bounds.left ||
                event.clientX > bounds.right ||
                event.clientY < bounds.top ||
                event.clientY > bounds.bottom)
            )
              requestAction(onClose);
          }}
        >
          {content}
        </dialog>
      ) : (
        <aside
          className="inspector"
          aria-label={baselineOriginal ? 'Cookie details' : 'New cookie'}
        >
          {content}
        </aside>
      )}
      {discardAction && (
        <Modal title="Discard changes?" onClose={() => setDiscardAction(null)}>
          <p>Your unsaved changes will be lost.</p>
          <div className="modal-actions">
            <button className="button" type="button" onClick={() => setDiscardAction(null)}>
              Keep editing
            </button>
            <button
              className="button danger-solid"
              type="button"
              onClick={() => {
                const action = discardAction;
                setDiscardAction(null);
                action();
              }}
            >
              Discard changes
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
