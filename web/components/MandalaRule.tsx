/**
 * The divider lifted from the logo's seal — the dotted diamond that rings the
 * monogram, reduced to its smallest readable form.
 *
 * Used only between major sections of a page. The restraint is the point: one
 * ornamental device, used sparingly, reads as a signature; the same device on
 * every card reads as wallpaper, and the storefront stops looking considered.
 */
export function MandalaRule({ className }: { className?: string }) {
  return (
    <div className={`mandala-rule px-4 ${className ?? 'py-2'}`} aria-hidden="true">
      <svg width="58" height="12" viewBox="0 0 58 12" fill="none" className="shrink-0">
        {/* Centre diamond, echoing the seal's four corner motifs. */}
        <path d="M29 1.5 32 6l-3 4.5L26 6Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" opacity="0.85" />
        <circle cx="29" cy="6" r="1.1" fill="currentColor" opacity="0.9" />
        {/* Graduated dots, densest nearest the centre, matching how the dots
            on the seal's border cluster toward each corner. */}
        <circle cx="20" cy="6" r="1" fill="currentColor" opacity="0.65" />
        <circle cx="13" cy="6" r="0.8" fill="currentColor" opacity="0.4" />
        <circle cx="7" cy="6" r="0.6" fill="currentColor" opacity="0.25" />
        <circle cx="38" cy="6" r="1" fill="currentColor" opacity="0.65" />
        <circle cx="45" cy="6" r="0.8" fill="currentColor" opacity="0.4" />
        <circle cx="51" cy="6" r="0.6" fill="currentColor" opacity="0.25" />
      </svg>
    </div>
  );
}
