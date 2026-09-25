'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '@/lib/api';
import { human } from '@/lib/format';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

export function PageHeader({ title, sub, actions, children }: { title: string; sub?: ReactNode; actions?: ReactNode; children?: ReactNode }) {
  return (
    <header className="border-b border-line bg-panel">
      <div className="flex flex-wrap items-end justify-between gap-3 px-6 pt-5 pb-4">
        <div className="min-w-0">
          <h1 className="text-[19px] font-semibold tracking-tight">{title}</h1>
          {sub && <p className="mt-0.5 text-[13px] text-muted">{sub}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="px-6">{children}</div>}
    </header>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode; count?: number }[] }) {
  return (
    <nav className="-mb-px flex gap-5 overflow-x-auto" role="tablist">
      {items.map((it) => (
        <button key={it.value} role="tab" aria-selected={value === it.value} onClick={() => onChange(it.value)}
          className={cx('flex h-9 items-center gap-1.5 border-b-2 text-[13px] whitespace-nowrap', value === it.value ? 'border-ink font-medium text-ink' : 'border-transparent text-muted hover:text-ink')}>
          {it.label}
          {it.count != null && it.count > 0 && <span className="num rounded-sm bg-sunk px-1 text-2xs text-ink-2">{it.count}</span>}
        </button>
      ))}
    </nav>
  );
}

export function Segmented<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode }[] }) {
  return (
    <div className="inline-flex rounded-sm border border-line-strong bg-panel p-0.5">
      {items.map((it) => (
        <button key={it.value} onClick={() => onChange(it.value)} className={cx('h-6 rounded-[2px] px-2.5 text-xs', value === it.value ? 'bg-ink text-white' : 'text-ink-2 hover:bg-sunk')}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, hint, error, children, className }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="label">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-bad">{error}</span> : hint ? <span className="hint block">{hint}</span> : null}
    </label>
  );
}

const TONE: Record<string, string> = {
  confirmed: 'ok', checked_in: 'accent', checked_out: 'neutral', pending_payment: 'warn', cancelled: 'neutral', expired: 'neutral', no_show: 'bad',
  paid: 'ok', captured: 'ok', partially_paid: 'warn', unpaid: 'neutral', awaiting_payment: 'warn', pending_verification: 'warn', rejected: 'bad', refunded: 'neutral', partially_refunded: 'neutral', charged_to_room: 'accent', failed: 'bad',
  new: 'warn', accepted: 'accent', preparing: 'accent', ready: 'ok', delivered: 'neutral', completed: 'neutral',
  open: 'warn', acknowledged: 'accent', in_progress: 'accent', resolved: 'ok', closed: 'neutral', assigned: 'accent', on_hold: 'neutral',
  waitlisted: 'warn', requested: 'warn', seated: 'accent',
  clean: 'ok', dirty: 'warn', inspected: 'accent', out_of_service: 'bad', pending: 'neutral', done: 'ok', failed_inspection: 'bad', skipped: 'neutral',
  urgent: 'bad', high: 'warn', normal: 'neutral', low: 'neutral', rush: 'bad', critical: 'bad', major: 'warn', minor: 'neutral',
  active: 'ok', suspended: 'bad', invited: 'warn', disabled: 'neutral', stored: 'neutral', returned: 'ok', claimed: 'ok', disposed: 'neutral',
};
export function Status({ value, label }: { value: string | null | undefined; label?: string }) {
  if (!value) return null;
  return <span className={`chip chip-${TONE[value] ?? 'neutral'}`}>{label ?? human(value)}</span>;
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="px-6 py-16 text-center">
      <p className="text-sm font-medium">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-sm text-[13px] text-muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Loading({ rows = 6 }: { rows?: number }) {
  return (
    <div className="space-y-2 px-6 py-6" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-7 animate-pulse rounded-sm bg-sunk" style={{ width: `${88 - ((i * 13) % 30)}%` }} />
      ))}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof ApiError ? error.message : error instanceof Error ? error.message : String(error);
  const moduleOff = error instanceof ApiError && error.code === 'module_disabled';
  return (
    <div className={cx('mx-6 my-4 rounded-sm border px-3 py-2 text-[13px]', moduleOff ? 'border-line bg-sunk text-ink-2' : 'border-bad/30 bg-bad-soft text-bad')}>
      {moduleOff ? 'This module is switched off for your property. An owner can enable it in Settings → Modules.' : msg}
    </div>
  );
}

export function Drawer({ open, onClose, title, sub, children, footer, width = 560 }: { open: boolean; onClose: () => void; title: ReactNode; sub?: ReactNode; children: ReactNode; footer?: ReactNode; width?: number }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink/20" onClick={onClose} />
      <section className="anim-drawer relative flex h-full w-full flex-col border-l border-line bg-panel" style={{ maxWidth: width }}>
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold">{title}</h2>
            {sub && <div className="mt-0.5 text-[13px] text-muted">{sub}</div>}
          </div>
          <button className="btn btn-ghost btn-sm -mr-2" onClick={onClose} aria-label="Close">Close</button>
        </header>
        <div className="flex-1 overflow-y-auto">{children}</div>
        {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
      </section>
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-[12vh]" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink/25" onClick={onClose} />
      <section className="anim-sheet relative w-full max-w-md rounded-md border border-line bg-panel">
        <header className="border-b border-line px-5 py-3.5"><h2 className="text-[15px] font-semibold">{title}</h2></header>
        <div className="px-5 py-4 text-[13px]">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
      </section>
    </div>
  );
}

export function Section({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('border-b border-line px-5 py-4', className)}>
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h3 className="eyebrow">{title}</h3>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Pager({ meta, onPage }: { meta?: { page: number; pages: number; total: number }; onPage: (p: number) => void }) {
  if (!meta || meta.pages <= 1) return meta ? <p className="px-6 py-3 text-xs text-muted">{meta.total} results</p> : null;
  return (
    <div className="flex items-center justify-between px-6 py-3 text-xs text-muted">
      <span>{meta.total} results · page {meta.page} of {meta.pages}</span>
      <div className="flex gap-1">
        <button className="btn btn-sm" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>Previous</button>
        <button className="btn btn-sm" disabled={meta.page >= meta.pages} onClick={() => onPage(meta.page + 1)}>Next</button>
      </div>
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [v, setV] = useState(value);
  const t = useRef<ReturnType<typeof setTimeout>>(undefined);
  return (
    <input className="input w-64" type="search" placeholder={placeholder} value={v}
      onChange={(e) => { setV(e.target.value); clearTimeout(t.current); t.current = setTimeout(() => onChange(e.target.value), 250); }} />
  );
}

// ---------- Toasts (state feedback only) ----------
type Toast = { id: number; text: string; tone: 'ok' | 'bad' };
const ToastCtx = createContext<(text: string, tone?: 'ok' | 'bad') => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: 'ok' | 'bad' = 'ok') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, text, tone }]);
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), tone === 'bad' ? 6000 : 3000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 flex-col items-center gap-2" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={cx('anim-sheet pointer-events-auto rounded-sm px-3.5 py-2 text-[13px] shadow-sm', t.tone === 'ok' ? 'bg-ink text-white' : 'bg-bad text-white')}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/** Wrap an async action with busy state and toast feedback. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async <T,>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> => {
    setBusy(true);
    try {
      const r = await fn();
      if (ok) toast(ok);
      return r;
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Something went wrong', 'bad');
      return undefined;
    } finally {
      setBusy(false);
    }
  }, [toast]);
  return { busy, run };
}
