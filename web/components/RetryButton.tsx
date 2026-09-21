'use client';

/**
 * Split out of the offline page because that page exports `metadata`, which a
 * client component cannot do — and an onClick handler is not allowed in a
 * server component. TypeScript does not catch that combination; the Next build
 * does.
 */
export function RetryButton() {
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className="rounded-xl bg-[var(--ink)] px-5 py-2.5 text-sm font-semibold text-[var(--gold-pale)]"
    >
      Try again
    </button>
  );
}
