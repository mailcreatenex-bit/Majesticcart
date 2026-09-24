import Link from 'next/link';
import type { CategoryNode } from '@/lib/catalog';
import { T } from './LocaleProvider';

/**
 * Desktop department bar. Each department opens a panel of its sub-categories on
 * hover or keyboard focus, using only CSS (`group-hover` / `group-focus-within`),
 * so the header stays a server component and the links are real, crawlable anchors.
 */
export function CategoryNav({ tree }: { tree: CategoryNode[] }) {
  return (
    <ul className="hidden items-center gap-0.5 xl:flex">
      <li>
        <Link href="/shop" className="rounded-full px-3 py-2 text-sm text-[var(--muted)] hover:bg-[var(--surface-tint)] hover:text-[var(--ink)]">
          <T k="nav.all" />
        </Link>
      </li>
      {tree.map((d) => (
        <li key={d.slug} className="group relative">
          <Link
            href={`/category/${d.slug}`}
            className="block whitespace-nowrap rounded-full px-3 py-2 text-sm text-[var(--muted)] hover:bg-[var(--surface-tint)] hover:text-[var(--ink)]"
          >
            {d.name}
          </Link>
          {d.children.length > 0 && (
            <div className="invisible absolute left-0 top-full z-50 w-64 pt-2 opacity-0 transition group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
              <ul className="max-h-[70vh] overflow-y-auto rounded-2xl border border-[var(--line-strong)] bg-[var(--surface)] p-2 shadow-xl">
                <li>
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
