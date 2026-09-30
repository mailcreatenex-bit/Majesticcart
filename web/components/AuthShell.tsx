import Link from 'next/link';
import Image from 'next/image';
import { SITE } from '@/lib/seo';
import { getTheme } from '@/lib/content';

/**
 * Shared shell for login, signup and password reset.
 *
 * These pages are indexable — someone searching "majestic cart login" should
 * find them — but they carry no income copy and no member data, so there is
 * nothing to hide from a crawler.
 *
 * The full seal appears here at real size, not just the small header badge —
 * this is the page a member checks when deciding whether the wallet they're
 * about to fund is a business they recognise, so the mark carries more
 * weight here than anywhere else in the shop.
 */
/**
 * The brand pitch that used to run across the homepage hero. Moved here so
 * the homepage banner can be pure imagery, while someone actually deciding
 * whether to log in or join still sees why the store is worth trusting.
 */
export async function AuthIntro() {
  const { authCopy } = await getTheme();
  const [line1, line2] = authCopy.introHeading.split('\n');
  return (
    <div className="mx-auto mb-10 max-w-2xl px-4 text-center">
      <p className="inline-block rounded-full bg-[var(--play-pink)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white">
        {authCopy.introEyebrow}
      </p>
      <h2 className="mt-3 font-serif text-2xl leading-tight text-[var(--ink)] sm:text-3xl">
        {line1}{line2 && <><br />{line2}</>}
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-[var(--body)]">
        {authCopy.introBody}
      </p>
    </div>
  );
}

export function AuthShell({ title, lead, children, footer }: {
  title: string; lead: string; children: React.ReactNode; footer?: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-md px-4 py-14">
      <div className="text-center">
        <Link href="/" className="inline-block">
          <Image src="/brand/majestic-cart-logo.webp" alt={SITE.name} width={512} height={512} priority className="mx-auto h-28 w-28" />
        </Link>
        <h1 className="mt-5 font-serif text-2xl text-[var(--ink)]">{title}</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">{lead}</p>
      </div>
      <div className="mt-8">{children}</div>
      {footer && <div className="mt-6 text-center text-sm text-[var(--muted)]">{footer}</div>}
    </div>
  );
}

export function Field({ label, hint, htmlFor, children }: {
  label: string; hint?: string; htmlFor: string; children: React.ReactNode;
}) {
  return (
    <div>
      {/* An explicit label, not a placeholder. Placeholder-only fields
          disappear the moment someone starts typing and are invisible to
          screen readers. */}
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-[var(--body)]">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-[var(--muted)]">{hint}</p>}
    </div>
  );
}

export const inputClass =
  'w-full rounded-xl border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-2.5 text-[15px] text-[var(--ink)] outline-none transition focus:border-[#B8862B] focus:ring-4 focus:ring-[#B8862B]/15';

export const primaryButtonClass =
  'w-full rounded-xl gold-foil px-6 py-3 font-semibold text-white shadow-lg shadow-amber-900/20 disabled:opacity-50';
