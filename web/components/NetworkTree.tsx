'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/money';
import { StatusPill } from './MemberShell';

/**
 * The team, as a tree instead of a flat list.
 *
 * Loads one branch at a time against `GET /me/network/:childId`, which
 * already existed and already enforces the same rule `/me/network` does: only
 * descendants inside the caller's own subtree, checked by ancestor-path
 * prefix, never the whole tree in one response. This component adds nothing
 * to that contract — it just draws what's already there, and asks for more
 * only when a person actually expands a branch.
 *
 * Depth is capped visually at 10 levels of indent regardless of how deep the
 * data goes, past which the connecting lines would be thinner than the text
 * sitting on them.
 */

export interface TreeNode {
  id: string;
  code: string;
  name: string;
  status: string;
  rankIndex: number;
  directCount: number;
  joinedAt: string;
}

export function NetworkTree({ rootLabel, nodes }: { rootLabel: string; nodes: TreeNode[] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
      <div className="flex items-center gap-2 pb-3">
        <RootDot />
        <span className="text-sm font-semibold text-[var(--ink)]">{rootLabel}</span>
      </div>
      <ul>
        {nodes.map((n, i) => (
          <TreeRow key={n.id} node={n} depth={0} isLast={i === nodes.length - 1} />
        ))}
      </ul>
    </div>
  );
}

function TreeRow({ node, depth, isLast }: { node: TreeNode; depth: number; isLast: boolean }) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<TreeNode[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const expandable = node.directCount > 0 && depth < 9;

  const toggle = async () => {
    if (!expandable) return;
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (children !== null) return; // already fetched this branch once
    setLoading(true);
    setError(null);
    try {
      const r = await api<{ children: TreeNode[] }>(`/me/network/${node.id}`);
      setChildren(r.children);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this branch.');
      setOpen(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <li className="relative pl-5">
      {/* The connecting lines: a vertical guide down this node's own
          indent column, and a short horizontal stub into the node itself —
          exactly what a file-tree or an org chart's collapsed view already
          uses, so it reads as hierarchy without a canvas or an SVG layout
          engine that would need its own mobile-width handling. */}
      <span
        aria-hidden="true"
        className={`absolute left-0 top-0 w-px bg-[var(--line-strong)] ${isLast ? 'h-[18px]' : 'h-full'}`}
      />
      <span aria-hidden="true" className="absolute left-0 top-[18px] h-px w-5 bg-[var(--line-strong)]" />

      <div className="flex items-center gap-2 py-2">
        <button
          type="button"
          onClick={toggle}
          disabled={!expandable}
          aria-expanded={expandable ? open : undefined}
          aria-label={expandable ? (open ? `Collapse ${node.name}'s team` : `Expand ${node.name}'s team`) : undefined}
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] ${
            expandable
              ? 'border-[var(--gold-mid)]/50 text-[var(--gold-mid)] hover:bg-[var(--surface-tint)]'
              : 'border-[var(--line)] text-[var(--faint)]'
          }`}
        >
          {loading ? <Spinner /> : expandable ? (open ? '−' : '+') : <NodeDot />}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="truncate text-sm font-medium text-[var(--ink)]">{node.name}</span>
            <code className="text-[11px] text-[var(--muted)]">{node.code}</code>
            <RankChip index={node.rankIndex} />
            <StatusPill status={node.status} />
          </div>
          <p className="text-[11px] text-[var(--faint)]">
            Joined {formatDate(node.joinedAt)}
            {node.directCount > 0 && ` · ${node.directCount} below`}
          </p>
        </div>
      </div>

      {error && <p role="alert" className="ml-8 pb-2 text-xs text-[#C0392B]">{error}</p>}

      {open && children && children.length > 0 && (
        <ul className="pl-3">
          {children.map((c, i) => (
            <TreeRow key={c.id} node={c} depth={depth + 1} isLast={i === children.length - 1} />
          ))}
        </ul>
      )}
      {open && children && children.length === 0 && (
        <p className="ml-8 pb-2 text-xs text-[var(--faint)]">No one below yet.</p>
      )}
    </li>
  );
}

/** Tiny, not the full crown — this is one line among possibly hundreds. */
function RankChip({ index }: { index: number }) {
  if (index <= 0) return null;
  return (
    <span className="rounded-full bg-[var(--gold-pale)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--gold-mid)]">
      R{index}
    </span>
  );
}

function NodeDot() {
  return <span className="block h-1.5 w-1.5 rounded-full bg-current" />;
}
function RootDot() {
  return <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--ink)] text-[10px] text-[var(--gold-pale)]">•</span>;
}
function Spinner() {
  return <span className="block h-2.5 w-2.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent" />;
}
