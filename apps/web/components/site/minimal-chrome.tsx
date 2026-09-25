import type { ReactNode } from 'react';

/** Quiet header for transactional pages (booking, payment, guest portal). */
export function MinimalChrome({ name, children, right }: { name: string; children: ReactNode; right?: ReactNode }) {
  return (
    <>
      <header className="border-b t-line" style={{ background: 'var(--t-bg)' }}>
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-5">
          <a href="/" className="display text-xl">{name}</a>
          {right}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-5 py-8 md:py-12">{children}</main>
    </>
  );
}
