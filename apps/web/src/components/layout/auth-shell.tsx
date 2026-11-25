import type { ReactNode } from 'react';

/** Shared input styling for the sign-in, forgot-password and reset-password screens. */
export const authFieldClass =
  'h-11 w-full rounded-md border border-line bg-surface px-3 text-body text-ink shadow-sm transition-colors placeholder:text-muted hover:border-line-strong focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20';

export const authButtonClass =
  'mt-8 h-11 w-full rounded-md bg-primary text-body font-medium text-on-primary shadow-sm transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60';

export const authLabelClass = 'block text-label font-medium text-ink';

function BrandMark({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <span className="grid size-9 place-items-center rounded-md bg-primary text-label font-semibold text-on-primary">GS</span>
      <span className="text-h3 font-semibold">GSC Peoples</span>
    </div>
  );
}

/** Split layout: brand panel on desktop, a single centred card below `lg`. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-dvh bg-bg lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <aside className="relative hidden overflow-hidden bg-sidebar p-12 text-on-sidebar lg:flex lg:flex-col lg:justify-between">
        <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full bg-primary/40 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 -left-16 size-96 rounded-full bg-accent/25 blur-3xl" />
        <BrandMark className="relative" />
        <div className="relative max-w-sm">
          <p className="text-[clamp(1.75rem,2.4vw,2.25rem)] font-semibold leading-tight tracking-tight">HR &amp; People CRM</p>
          <p className="mt-3 text-body text-on-sidebar-muted">GrowSpark Consulting Business Platform</p>
        </div>
        <span aria-hidden="true" />
      </aside>

      <section className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-[400px] rounded-lg bg-surface p-6 shadow-md sm:p-8">
          <BrandMark className="mb-8 text-ink lg:hidden" />
          {children}
        </div>
      </section>
    </main>
  );
}

export function AuthHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <>
      <h1 className="text-[clamp(1.5rem,2vw,1.75rem)] font-semibold leading-tight tracking-tight text-ink">{title}</h1>
      {subtitle && <p className="mt-1.5 text-body text-muted">{subtitle}</p>}
    </>
  );
}

export function AuthError({ children }: { children: ReactNode }) {
  return <p role="alert" className="mt-5 rounded-md bg-danger-soft px-3 py-2.5 text-small text-danger">{children}</p>;
}

export function AuthNotice({ children }: { children: ReactNode }) {
  return <p role="status" className="mt-5 rounded-md bg-success-soft px-3 py-2.5 text-small text-success">{children}</p>;
}
