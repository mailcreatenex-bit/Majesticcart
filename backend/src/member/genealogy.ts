import { BadRequestException } from '@nestjs/common';

/**
 * Genealogy paths.
 *
 * Every commission payout walks this structure, so the invariants here are
 * load-bearing. Pure functions, no database, exhaustively tested.
 *
 * Format: root first, slash delimited, leading and trailing slash.
 *
 *   company            ancestorPath "/"                depth 0
 *   under company      ancestorPath "/company/"        depth 1
 *   under that member  ancestorPath "/company/m1/"     depth 2
 *
 * Two queries fall out of it:
 *   upline of X    split X.ancestorPath, then reverse for nearest-first
 *   downline of X  ancestorPath LIKE (X.ancestorPath || X.id || '/%')
 *
 * The trailing slash is what makes the prefix match safe: without it, member
 * "m1" would match "m12" and pay commission into the wrong leg.
 */

export interface Placeable {
  id: string;
  ancestorPath: string;
  depth: number;
}

/** Hard ceiling on tree depth. Guards against a cycle or runaway chain. */
export const MAX_DEPTH = 200;

export function childPath(sponsor: Placeable): { ancestorPath: string; depth: number } {
  if (!sponsor.ancestorPath.startsWith('/') || !sponsor.ancestorPath.endsWith('/')) {
    throw new Error(`Malformed ancestorPath on ${sponsor.id}: "${sponsor.ancestorPath}"`);
  }
  const depth = sponsor.depth + 1;
  if (depth > MAX_DEPTH) {
    throw new BadRequestException('This sponsor sits too deep in the network. Contact support.');
  }
  return { ancestorPath: `${sponsor.ancestorPath}${sponsor.id}/`, depth };
}

/** Ancestor ids, root first — the order they are stored in. */
export const ancestorIds = (ancestorPath: string): string[] => ancestorPath.split('/').filter(Boolean);

/** Ancestor ids nearest-first: sponsor, then sponsor's sponsor, and upward. */
export const uplineIds = (ancestorPath: string): string[] => ancestorIds(ancestorPath).reverse();

/** Prefix for matching everyone below a member. Always ends in a slash. */
export const downlinePrefix = (member: Placeable): string => `${member.ancestorPath}${member.id}/`;

export const isDescendantOf = (candidate: Placeable, ancestor: Placeable): boolean =>
  candidate.ancestorPath.startsWith(downlinePrefix(ancestor));

/**
 * A member may not be placed under their own descendant — that closes a loop
 * and the upline walk would never terminate. Cannot happen through normal
 * signup, since a new member has no downline, but it is exactly the mistake an
 * admin re-parenting tool would make.
 */
export function assertNoCycle(member: Placeable, newSponsor: Placeable): void {
  if (member.id === newSponsor.id) {
    throw new BadRequestException('A member cannot sponsor themselves.');
  }
  if (isDescendantOf(newSponsor, member)) {
    throw new BadRequestException('That sponsor is already in this member\'s downline. The placement would form a loop.');
  }
}

/**
 * Rebuild a subtree's paths after re-parenting. Return value feeds one bulk
 * update; never patch paths row by row, since a half-applied rewrite leaves the
 * tree inconsistent and every payout after it wrong.
 */
export function rewriteSubtree(
  moved: Placeable,
  newSponsor: Placeable,
  descendants: Placeable[],
): { id: string; ancestorPath: string; depth: number }[] {
  assertNoCycle(moved, newSponsor);

  const next = childPath(newSponsor);
  const oldPrefix = downlinePrefix(moved);
  const newPrefix = `${next.ancestorPath}${moved.id}/`;
  const depthShift = next.depth - moved.depth;

  const out = [{ id: moved.id, ancestorPath: next.ancestorPath, depth: next.depth }];
  for (const d of descendants) {
    if (!d.ancestorPath.startsWith(oldPrefix)) continue;
    out.push({
      id: d.id,
      ancestorPath: newPrefix + d.ancestorPath.slice(oldPrefix.length),
      depth: d.depth + depthShift,
    });
  }
  return out;
}

/**
 * Member codes are what people share as their sponsor ID, so they are sequential
 * and readable rather than a cuid. Allocated from the NumberSeries counter.
 */
export const formatMemberCode = (n: number, prefix = 'MC'): string => `${prefix}${n}`;

export function parseMemberCode(code: string, prefix = 'MC'): number | null {
  const m = new RegExp(`^${prefix}(\\d+)$`, 'i').exec((code ?? '').trim());
  return m ? Number(m[1]) : null;
}
