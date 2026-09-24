import Link from 'next/link';
import type { ThemeSettings } from '@/lib/content';

/**
 * The festival / offer strip across the top of the storefront.
 *
 * Written in the console (Theme > Festival banner), shown only while switched on and
 * inside its dates. The pages are cached for up to an hour, so a banner appears or
 * goes within the hour of its start or end date rather than at midnight.
 */
export function AnnouncementBar({ a }: { a: ThemeSettings['announcement'] }) {
  if (!a?.enabled || !a.text.trim()) return null;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD
  if (a.startsOn && today < a.startsOn) return null;
  if (a.endsOn && today > a.endsOn) return null;

  return (
    <div role="region" aria-label="Announcement" className="bg-gradient-to-r from-[#8a6a2b] via-[#D9B25A] to-[#8a6a2b] px-4 py-2 text-center text-xs font-semibold text-[#2a1416] sm:text-sm">
      <span>{a.text}</span>
      {a.couponCode && (
        <span className="mx-2 inline-block rounded-md border border-[#2a1416]/40 bg-white/40 px-2 py-0.5 font-mono tracking-wider">{a.couponCode}</span>
      )}
      {a.linkHref && a.linkLabel && (
        <Link href={a.linkHref} className="ml-1 underline decoration-[#2a1416]/50 underline-offset-2 hover:decoration-[#2a1416]">{a.linkLabel} →</Link>
      )}
    </div>
  );
}
