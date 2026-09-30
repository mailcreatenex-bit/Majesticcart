import Link from 'next/link';
import type { CategoryNode } from '@/lib/catalog';
import { T } from './LocaleProvider';

/**
 * Desktop department bar. Each department opens a panel of its sub-categories on
 * hover or keyboard focus, using only CSS (`group-hover` / `group-focus-within`),
 * so the header stays a server component and the links are real, crawlable anchors.
 *
 * Flat, bold text links rather than pill buttons — the Purplle-style nav bar
 * the client asked for — and the dropdown panel wraps into two columns once a
 * department has enough sub-categories to need it, reading as a proper mega
 * menu instead of a long single-column list.
 */
export function CategoryNav({ tree }: { tree: CategoryNode[] }) {
  return (
    <ul className="hidden items-center gap-5 xl:flex">
      <li>
        <Link href="/shop" className="text-sm font-semibold uppercase tracking-wide text-[var(--body)] transition hover:text-[var(--accent)]">
          <T k="nav.all" />
        </Link>
      </li>
      {tree.map((d) => (
        <li key={d.slug} className="group relative">
          <Link
            href={`/category/${d.slug}`}
            className="block whitespace-nowrap text-sm font-semibold uppercase tracking-wide text-[var(--body)] transition hover:text-[var(--accent)]"
          >
            {d.name}
          </Link>
          {d.children.length > 0 && (
            <div className="invisible absolute left-0 top-full z-50 pt-3 opacity-0 transition group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
              <ul
                className={`max-h-[70vh] overflow-y-auto rounded-2xl border border-[var(--line-strong)] bg-[var(--surface)] p-2 shadow-xl ${d.children.length > 6 ? 'grid w-96 grid-cols-2 gap-x-1' : 'w-64'}`}
              >
                <li className={d.children.length > 6 ? 'col-span-2' : ''}>
                  <Link href={`/category/${d.slug}`} className="block rounded-lg px-3 py-2 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-tint)]">
                    <T k="nav.allIn" /> {d.name}
                  </Link>
                </li>
                {d.children.map((c) => (
                  <li key={c.slug}>
                    <Link href={`/category/${c.slug}`} className="block rounded-lg px-3 py-2 text-sm text-[var(--body)] hover:bg-[var(--surface-tint)] hover:text-[var(--ink)]">
                      {c.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
