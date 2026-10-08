import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Link2, X, AlertCircle, Database, ShieldCheck, ArrowRight } from 'lucide-react';
import { useWorkspace } from './context';

export function Brand() {
  return (
    <div className="brand">
      <Link2 aria-hidden="true" className="brand-mark" size={25} strokeWidth={2.5} />
      <span>Cookie Loom</span>
    </div>
  );
}
export function IconButton({
  label,
  children,
  onClick,
  disabled = false,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      className="icon-button"
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      opener?.focus();
    };
  }, []);
  return (
    <dialog
      className={`modal ${wide ? 'wide' : ''}`}
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
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
          onClose();
      }}
    >
      <div className="modal-heading">
        <h2 id={titleId}>{title}</h2>
        <IconButton label="Close dialog" onClick={onClose}>
          <X size={20} />
        </IconButton>
      </div>
      {children}
    </dialog>
  );
}
export function ErrorNotice({ children }: { children: ReactNode }) {
  return (
    <div className="notice error-notice" role="alert">
      <AlertCircle size={18} />
      <div>{children}</div>
    </div>
  );
}
export function Connect() {
  const { gateway, refresh, notify } = useWorkspace();
  async function connect() {
    try {
      const granted = await gateway.requestHostAccess();
      await refresh();
      if (!granted) notify('Access not granted. Try again when ready.');
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : 'Could not request access.');
    }
  }
  return (
    <section className="connect-screen">
      <div className="connect-icon">
        <Database size={36} />
      </div>
      <h2>Connect your browser</h2>
      <p>Allow access to read and manage cookies on HTTP and HTTPS websites.</p>
      <button className="button primary" onClick={() => void connect()}>
        Allow website access <ArrowRight size={17} />
      </button>
      <div className="connect-foot">
        <ShieldCheck size={15} /> Your cookies stay in this browser.
      </div>
      <p className="small muted">
        Access applies to all websites. Revoke it anytime in extension settings.
      </p>
    </section>
  );
}
export function hostOf(url?: string) {
  try {
    const parsed = new URL(url ?? '');
    return /^https?:$/.test(parsed.protocol) ? parsed.hostname : '';
  } catch {
    return '';
  }
}
export function expiryLabel(session: boolean, expirationDate?: number) {
  return session || expirationDate === undefined
    ? 'Session'
    : new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }).format(new Date(expirationDate * 1000));
}
export async function copyText(text: string) {
  await navigator.clipboard.writeText(text);
}
