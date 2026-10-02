'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { T } from './LocaleProvider';

/**
 * The horizontally scrolling department tabs under the phone search bar —
 * the Purplle-app pattern: a small line icon over an uppercase label, the
 * current section marked with a bar underneath. "All" goes to the homepage,
 * every other tab to its department, and the list is the live catalogue's
 * own top-level categories so it never drifts from what the shop sells.
 *
 * Plain anchors inside a native scroller: no carousel script, swipes on
 * touch, and the active tab is scrolled into view on mount.
 */
export function MobileCategoryTabs({ departments }: { departments: { slug: string; name: string }[] }) {
  const pathname = usePathname() ?? '/';

  // Browsing pages only. On a product, the bag, an account page and the like the
  // tabs are noise above what the visitor came to do (Purplle's own product
  // and cart screens drop them too).
  const browsing = pathname === '/' || pathname === '/shop' || pathname.startsWith('/category') || pathname.startsWith('/brand') || pathname.startsWith('/search');
  if (!browsing) return null;

  const tabs = [
    { key: 'all', href: '/', label: null as string | null, active: pathname === '/' || pathname === '/shop' },
    ...departments.map((d) => ({
      key: d.slug,
      href: `/category/${d.slug}`,
      label: d.name,
      active: pathname === `/category/${d.slug}`,
    })),
  ];

  return (
    <nav aria-label="Departments" className="xl:hidden">
      <ul className="no-scrollbar flex overflow-x-auto px-2">
        {tabs.map((t) => (
          <li key={t.key} className="shrink-0">
            <Link
              href={t.href}
              aria-current={t.active ? 'page' : undefined}
              ref={(el) => { if (el && t.active) el.scrollIntoView({ inline: 'center', block: 'nearest' }); }}
              className={`relative flex min-w-[4.5rem] flex-col items-center gap-1 px-3 pb-2.5 pt-3 text-[11px] font-semibold uppercase tracking-wide transition-colors ${t.active ? 'text-white' : 'text-white/75 hover:text-white'}`}
            >
              <TabIcon slug={t.key} />
              <span className="whitespace-nowrap">{t.label ?? <T k="nav.allIn" />}</span>
              {t.active && <span aria-hidden="true" className="absolute inset-x-2 bottom-0 h-[3px] rounded-t-full bg-white" />}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** One simple line icon per kind of department, matched on the slug's wording; anything unrecognised gets the sparkle. */
function TabIcon({ slug }: { slug: string }) {
  const s = slug.toLowerCase();
  const common = { width: 26, height: 26, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };

  if (s === 'all') {
    return (
      <svg {...common}>
        <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" />
        <path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
      </svg>
    );
  }
  if (s.includes('skin')) {
    return (
      <svg {...common}>
        <path d="M9 3h6v3l1.5 3V19a2 2 0 0 1-2 2h-5a2 2 0 0 1-2-2V9L9 6z" />
        <path d="M9 12h6" />
      </svg>
    );
  }
  if (s.includes('makeup') || s.includes('lip')) {
    return (
      <svg {...common}>
        <path d="M9 21v-7h6v7zM10 14V9l2-6 2 6v5" />
      </svg>
    );
  }
  if (s.includes('hair')) {
    return (
      <svg {...common}>
        <path d="M5 4h14v5H5zM7 9v11M10 9v11M13 9v11M16 9v11" />
      </svg>
    );
  }
  if (s.includes('fragrance') || s.includes('perfume')) {
    return (
      <svg {...common}>
        <path d="M9 3h6v3H9zM8 6h8a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" />
        <path d="M10 13h4" />
      </svg>
    );
  }
  if (s.includes('bath') || s.includes('body')) {
    return (
      <svg {...common}>
        <path d="M4 12h16v3a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM6 12V6a2 2 0 0 1 4 0" />
      </svg>
    );
  }
  if (s.includes('personal') || s.includes('care')) {
    return (
      <svg {...common}>
        <path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 11c0 5.5-7 10-7 10z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" />
    </svg>
  );
}
