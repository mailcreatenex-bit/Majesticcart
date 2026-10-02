import type { CSSProperties } from 'react';

/**
 * Where the face sits in each stock photo, so a banner that crops the photo
 * with `object-cover` frames the face instead of whatever the middle happens
 * to be. A tall portrait (a face near the top of a 2:3 frame) cropped into a
 * 21:9 strip is the case this exists for: a plain centre crop shows a torso.
 *
 * `x`/`y` are the face centre as fractions of the image; `w`/`h` are its pixel
 * size, which the aspect-ratio maths needs. Product-only shots are centred
 * (0.5, 0.5). Anything not listed - an image an admin uploaded later - falls
 * back to a gentle upward bias, since faces sit in the upper part of a photo
 * far more often than the middle.
 */
interface Focal { w: number; h: number; x: number; y: number }

const FOCAL: Record<string, Focal> = {
  '/home/about-1.jpg': { w: 1000, h: 1200, x: 0.5, y: 0.5 },
  '/home/about-2.jpg': { w: 1000, h: 1200, x: 0.5, y: 0.5 },
  '/home/category-bath-body-model.jpg': { w: 900, h: 700, x: 0.27, y: 0.3 },
  '/home/category-bath-body.jpg': { w: 900, h: 700, x: 0.5, y: 0.5 },
  '/home/category-bathbody-2.jpg': { w: 1600, h: 1068, x: 0.445, y: 0.54 },
  '/home/category-fragrance-2.jpg': { w: 1600, h: 1029, x: 0.61, y: 0.41 },
  '/home/category-fragrance.jpg': { w: 900, h: 700, x: 0.5, y: 0.5 },
  '/home/category-hair-care.jpg': { w: 900, h: 700, x: 0.5, y: 0.5 },
  '/home/category-haircare-2.jpg': { w: 1600, h: 2400, x: 0.49, y: 0.42 },
  '/home/category-makeup-2.jpg': { w: 1600, h: 1067, x: 0.56, y: 0.44 },
  '/home/category-makeup.jpg': { w: 900, h: 700, x: 0.5, y: 0.5 },
  '/home/category-personal-care-model.jpg': { w: 900, h: 700, x: 0.51, y: 0.29 },
  '/home/category-personal-care.jpg': { w: 900, h: 700, x: 0.5, y: 0.5 },
  '/home/category-personalcare-2.jpg': { w: 1600, h: 2447, x: 0.38, y: 0.35 },
  '/home/category-skin-care.jpg': { w: 900, h: 700, x: 0.5, y: 0.5 },
  '/home/editorial-1.jpg': { w: 768, h: 1376, x: 0.54, y: 0.22 },
  '/home/editorial-2.jpg': { w: 768, h: 1376, x: 0.527, y: 0.161 },
  '/home/editorial-3.jpg': { w: 768, h: 1376, x: 0.52, y: 0.15 },
  '/home/editorial-4.jpg': { w: 853, h: 1280, x: 0.545, y: 0.186 },
  '/home/editorial-5.jpg': { w: 768, h: 1376, x: 0.476, y: 0.208 },
  '/home/editorial-6.jpg': { w: 853, h: 1280, x: 0.608, y: 0.285 },
  '/home/editorial-7.jpg': { w: 768, h: 1376, x: 0.489, y: 0.262 },
  '/home/editorial-8.jpg': { w: 1376, h: 768, x: 0.48, y: 0.2 },
  '/home/editorial-9.jpg': { w: 1376, h: 768, x: 0.47, y: 0.17 },
  '/home/explore-account.jpg': { w: 1600, h: 1067, x: 0.513, y: 0.327 },
  '/home/explore-faq.jpg': { w: 1600, h: 2400, x: 0.62, y: 0.33 },
  '/home/explore-join.jpg': { w: 1600, h: 1067, x: 0.507, y: 0.423 },
  '/home/explore-network.jpg': { w: 1600, h: 2520, x: 0.48, y: 0.415 },
  '/home/explore-shade-finder.jpg': { w: 1600, h: 2400, x: 0.484, y: 0.314 },
  '/home/explore-shop.jpg': { w: 1600, h: 2400, x: 0.52, y: 0.45 },
  '/home/explore-wallet.jpg': { w: 1600, h: 1069, x: 0.381, y: 0.381 },
  '/home/hero-1.jpg': { w: 1200, h: 900, x: 0.7, y: 0.4 },
  '/home/hero-2.jpg': { w: 1200, h: 900, x: 0.55, y: 0.5 },
  '/home/hero-3.jpg': { w: 1200, h: 900, x: 0.535, y: 0.367 },
  '/home/hero-4.jpg': { w: 1024, h: 1024, x: 0.52, y: 0.34 },
  '/home/hero-5.jpg': { w: 1600, h: 2397, x: 0.5, y: 0.419 },
  '/home/hero-6.jpg': { w: 1600, h: 2400, x: 0.465, y: 0.229 },
  '/home/hero-7.jpg': { w: 1600, h: 2400, x: 0.621, y: 0.361 },
  '/home/promo-banner-1.jpg': { w: 1024, h: 1024, x: 0.5, y: 0.36 },
  '/home/promo-banner-2.jpg': { w: 1024, h: 1024, x: 0.77, y: 0.45 },
  '/home/promo-banner-3.jpg': { w: 1024, h: 1024, x: 0.72, y: 0.35 },
  '/home/promo-banner-4.jpg': { w: 1024, h: 1024, x: 0.72, y: 0.32 },
  '/home/shop-banner.jpg': { w: 1600, h: 1067, x: 0.492, y: 0.296 },
  '/home/skin-1.jpg': { w: 1408, h: 768, x: 0.46, y: 0.38 },
  '/home/skin-2.jpg': { w: 1408, h: 768, x: 0.4, y: 0.28 },
  '/home/skin-3.jpg': { w: 1408, h: 768, x: 0.489, y: 0.374 },
  '/home/skin-4.jpg': { w: 1408, h: 768, x: 0.501, y: 0.439 },
};

const FALLBACK = '50% 25%';
const clamp = (n: number) => Math.min(1, Math.max(0, n));
const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

/**
 * The `object-position` that puts the face in the window when the photo is
 * cropped to a box of `boxAspect` (width / height).
 *
 * If the box is wider than the photo only a horizontal slice of the height
 * shows, so the vertical position is solved so the face lands slightly above
 * the middle of the slice (a little headroom looks right); if the box is
 * taller than the photo, the same is done along the horizontal axis.
 */
export function faceObjectPosition(src: string | null | undefined, boxAspect: number): string {
  const f = src ? FOCAL[src.split('?')[0]] : undefined;
  if (!f) return FALLBACK;
  const imageAspect = f.w / f.h;
  if (boxAspect > imageAspect) {
    const visible = imageAspect / boxAspect;
    return `50% ${pct(clamp((f.y - 0.45 * visible) / (1 - visible)))}`;
  }
  if (boxAspect < imageAspect) {
    const visible = boxAspect / imageAspect;
    return `${pct(clamp((f.x - 0.5 * visible) / (1 - visible)))} 50%`;
  }
  return '50% 50%';
}

/**
 * Props for an `object-cover` <Image> whose box changes shape between phone
 * and sm+: `base` is the aspect ratio below sm, `sm` the one from sm up
 * (omit it if they match). Spread onto the Image; add your own classes after.
 */
export function faceCrop(src: string | null | undefined, base: number, sm: number = base): { style: CSSProperties; className: string } {
  return {
    style: { '--op': faceObjectPosition(src, base), '--op-sm': faceObjectPosition(src, sm) } as CSSProperties,
    className: 'object-cover [object-position:var(--op)] sm:[object-position:var(--op-sm)]',
  };
}
