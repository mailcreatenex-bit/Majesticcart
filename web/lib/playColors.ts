/**
 * Cycles a string (a category name, a brand name) to one of five "playful"
 * colour slots defined in globals.css, so the same value always lands on the
 * same colour within a session instead of jumping around on every render.
 */
function hashIndex(key: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % mod;
}

export const playChipClass = (key: string): string => `chip-play-${hashIndex(key, 7)}`;
export const playTileClass = (key: string): string => `tile-play-${hashIndex(key, 7)}`;
