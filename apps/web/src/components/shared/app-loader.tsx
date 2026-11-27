/**
 * Branded full-screen loader for application start-up only (e.g. arriving from sign-in, before the app shell has
 * mounted). Navigation between pages inside the app never shows it: each page has its own `loading.tsx` skeleton
 * and the shell stays mounted.
 *
 * Theme-aware (tokens only), centred with fixed sizes so nothing jumps when the app replaces it, and the motion
 * stops under prefers-reduced-motion.
 */
export function AppLoader({ label = 'Loading GSC Peoples' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="fixed inset-0 z-[400] grid place-items-center bg-bg px-4">
      <div className="flex flex-col items-center gap-5">
        <div className="flex items-center gap-3 text-ink">
          <span className="grid size-10 place-items-center rounded-md bg-primary text-label font-semibold text-on-primary shadow-sm">
            GS
          </span>
          <span className="text-h3 font-semibold">GSC Peoples</span>
        </div>
        <span aria-hidden className="flex h-2 items-center gap-1.5">
          {[0, 160, 320].map((delay) => (
            <span
              key={delay}
              className="size-1.5 animate-pulse rounded-full bg-primary motion-reduce:animate-none"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </span>
        <span className="sr-only">{label}</span>
      </div>
    </div>
  );
}
