/**
 * Share images and messages for a member to send to people they know.
 *
 * Nothing here talks about earnings. A message that promises income is the kind
 * of thing the Direct Selling Rules exist to stop, and it would be the member's
 * name on it - so the copy is about the products and the fact that registering is
 * free, and `assertNoIncomeClaims` (lib/seo) is run over every template by the
 * page's test.
 *
 * Images are SVG strings with the logo and QR code embedded, drawn to a canvas for
 * download - the same approach as the ID card.
 */

export interface ShareData {
  name: string;
  code: string;
  /** The member's storefront or referral link, as shown. */
  link: string;
  /** data: URL of the logo, or null. */
  logo: string | null;
  /** SVG markup of a QR code for `link` (from the `qrcode` package), or null. */
  qrSvg: string | null;
}

export type ShareKind = 'post' | 'story';
export const SHARE_SIZE: Record<ShareKind, { w: number; h: number; label: string }> = {
  post: { w: 1080, h: 1080, label: 'Square post' },
  story: { w: 1080, h: 1920, label: 'Story (9:16)' },
};

const GOLD = '#D9B25A';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const SERIF = "Georgia,'Times New Roman',serif";
const SANS = "'Segoe UI',Arial,Helvetica,sans-serif";

/** Pull the inner markup and viewBox size out of a qrcode-generated <svg>, to place it at any size. */
function qrGroup(qrSvg: string | null, x: number, y: number, size: number): string {
  if (!qrSvg) return '';
  const vb = /viewBox="0 0 (\d+) (\d+)"/.exec(qrSvg);
  const inner = /<svg[^>]*>([\s\S]*)<\/svg>/.exec(qrSvg)?.[1];
  if (!vb || !inner) return '';
  const scale = size / Number(vb[1]);
  return `<g transform="translate(${x} ${y}) scale(${scale})">${inner}</g>`;
}

const fit = (text: string, size: number, maxW: number) =>
  text.length * size * 0.58 > maxW ? ` textLength="${maxW}" lengthAdjust="spacingAndGlyphs"` : '';

export function buildShareSvg(kind: ShareKind, d: ShareData): string {
  const { w, h } = SHARE_SIZE[kind];
  const story = kind === 'story';
  const top = story ? 150 : 40;
  const logoSize = story ? 340 : 200;
  const head = top + logoSize + (story ? 60 : 20);
  const qr = story ? 400 : 240;
  const hs = story ? 84 : 62; // headline size

  const link = d.link.replace(/^https?:\/\//, '');
  const blocks = [
    `<rect width="${w}" height="${h}" fill="url(#bg)"/>`,
    `<circle cx="${w * 0.9}" cy="${h * 0.08}" r="${story ? 380 : 300}" fill="${GOLD}" opacity="0.07"/>`,
    `<circle cx="${w * 0.05}" cy="${h * 0.95}" r="${story ? 420 : 320}" fill="#E88B97" opacity="0.08"/>`,
    d.logo
      ? `<image href="${d.logo}" x="${(w - logoSize) / 2}" y="${top}" width="${logoSize}" height="${logoSize}"/>`
      : `<text x="${w / 2}" y="${top + logoSize / 2}" text-anchor="middle" font-family="${SERIF}" font-size="72" fill="${GOLD}" font-weight="700">Majestic Cart</text>`,
    `<text x="${w / 2}" y="${head + (story ? 70 : 62)}" text-anchor="middle" font-family="${SERIF}" font-size="${hs}" font-weight="700" fill="#F7EBEC">Beauty you trust,</text>`,
    `<text x="${w / 2}" y="${head + (story ? 170 : 132)}" text-anchor="middle" font-family="${SERIF}" font-size="${hs}" font-weight="700" fill="${GOLD}">delivered to you.</text>`,
    `<text x="${w / 2}" y="${head + (story ? 250 : 190)}" text-anchor="middle" font-family="${SANS}" font-size="${story ? 38 : 30}" fill="#DCC6C9">Lakmé · Himalaya · Lotus Herbals · Pond’s · Dot &amp; Key · and more</text>`,
  ];

  const cardY = story ? head + 340 : head + 235;
  const cardH = story ? 780 : 480;
  blocks.push(`<rect x="70" y="${cardY}" width="${w - 140}" height="${cardH}" rx="44" fill="#FFFFFF"/>`);
  blocks.push(`<text x="${w / 2}" y="${cardY + (story ? 84 : 66)}" text-anchor="middle" font-family="${SANS}" font-size="${story ? 34 : 28}" font-weight="600" fill="#93767B" letter-spacing="3">JOIN WITH MY MEMBER ID</text>`);
  blocks.push(`<text x="${w / 2}" y="${cardY + (story ? 170 : 148)}" text-anchor="middle" font-family="${SERIF}" font-size="${story ? 96 : 84}" font-weight="700" fill="#341316">${esc(d.code)}</text>`);
  if (d.qrSvg) {
    blocks.push(qrGroup(d.qrSvg, (w - qr) / 2, cardY + (story ? 210 : 178), qr));
    blocks.push(`<text x="${w / 2}" y="${cardY + (story ? 210 : 178) + qr + (story ? 56 : 44)}" text-anchor="middle" font-family="${SANS}" font-size="${story ? 32 : 26}" fill="#624144">Scan to open — registering is free</text>`);
  } else {
    blocks.push(`<text x="${w / 2}" y="${cardY + 290}" text-anchor="middle" font-family="${SANS}" font-size="34" fill="#624144"${fit(link, 34, w - 200)}>${esc(link)}</text>`);
  }
  const nameY = h - (story ? 150 : 62);
  blocks.push(`<text x="${w / 2}" y="${nameY}" text-anchor="middle" font-family="${SANS}" font-size="${story ? 38 : 32}" fill="#F7EBEC"${fit(`Shared by ${d.name}`, 38, w - 160)}>Shared by ${esc(d.name)}</text>`);
  blocks.push(`<text x="${w / 2}" y="${nameY + (story ? 52 : 38)}" text-anchor="middle" font-family="${SANS}" font-size="${story ? 28 : 24}" fill="#AD9296"${fit(link, 28, w - 160)}>${esc(link)}</text>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="${SANS}">
<defs><linearGradient id="bg" x1="0" y1="0" x2="0.4" y2="1"><stop offset="0" stop-color="#341316"/><stop offset="1" stop-color="#1A0E10"/></linearGradient></defs>
${blocks.join('\n')}
</svg>`;
}

/** WhatsApp-ready messages. The link is put on its own line so it previews well. */
export function shareMessages(d: { name: string; code: string; link: string }): { id: string; title: string; text: string }[] {
  const first = d.name.split(' ')[0];
  return [
    {
      id: 'intro',
      title: 'Introduce the store',
      text: `Hi! I shop beauty and personal care at Majestic Cart - Lakmé, Himalaya, Lotus Herbals, Pond's, Dot & Key and lots more, delivered to your door. Have a look:\n${d.link}\n\n- ${first}`,
    },
    {
      id: 'member',
      title: 'Invite someone to register',
      text: `Registering at Majestic Cart is free. You can sign up with my member ID ${d.code} and shop the range:\n${d.link}\n\n- ${first}`,
    },
    {
      id: 'status',
      title: 'Short message for a status or group',
      text: `Beauty and personal care from brands you already know, all in one place: ${d.link}`,
    },
  ];
}

export const whatsappUrl = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;

/* ------------------------------------------------------------- the share kit */

export interface KitProduct {
  slug: string;
  name: string;
  brand?: string | null;
  price: { display: string; paise: number };
  mrp: { display: string; paise: number };
  imageUrl?: string;
}

const off = (p: KitProduct) => (p.mrp.paise > p.price.paise ? Math.round((1 - p.price.paise / p.mrp.paise) * 100) : 0);

/** Break a product name over up to three lines of roughly `max` characters, ending in an ellipsis if it still does not fit. */
function wrapLines(text: string, max: number, lines = 3): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest && out.length < lines) {
    if (rest.length <= max) { out.push(rest); rest = ''; break; }
    const cut = rest.lastIndexOf(' ', max);
    const at = cut > max * 0.4 ? cut : max;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) out[out.length - 1] = `${out[out.length - 1].slice(0, max - 1).trimEnd()}…`;
  return out;
}

/**
 * A square branded image for one product: the photo, name, price, and the
 * member's ID and a QR code to the product (carrying their link). Prices and
 * the discount are the shop's own; nothing here mentions earning.
 */
export function buildProductSvg(
  p: KitProduct,
  d: { name: string; code: string; link: string; photo: string | null; logo: string | null; qrSvg: string | null },
): string {
  const w = 1080;
  const h = 1080;
  const nameLines = wrapLines(p.name, 17);
  const pct = off(p);
  const X = 640;
  const priceY = 200 + nameLines.length * 50 + 70;
  const body = [
    `<rect width="${w}" height="${h}" fill="#FBF4F2"/>`,
    // The photo, cropped to a rounded panel.
    `<clipPath id="ph"><rect x="60" y="60" width="540" height="760" rx="36"/></clipPath>`,
    `<rect x="60" y="60" width="540" height="760" rx="36" fill="#F1E3E0"/>`,
    d.photo ? `<image href="${d.photo}" x="60" y="60" width="540" height="760" preserveAspectRatio="xMidYMid slice" clip-path="url(#ph)"/>` : '',
    pct >= 5 ? `<rect x="60" y="86" width="190" height="64" fill="#B84654"/><text x="155" y="130" text-anchor="middle" font-family="${SANS}" font-size="34" font-weight="700" fill="#fff">${pct}% OFF</text>` : '',
    // Right column: brand, name, price.
    p.brand ? `<text x="${X}" y="120" font-family="${SANS}" font-size="24" font-weight="600" letter-spacing="3" fill="#93767B"${fit(p.brand.toUpperCase(), 24, 380)}>${esc(p.brand.toUpperCase())}</text>` : '',
    ...nameLines.map((line, i) => `<text x="${X}" y="${190 + i * 50}" font-family="${SERIF}" font-size="40" font-weight="700" fill="#341316">${esc(line)}</text>`),
    `<text x="${X}" y="${priceY}" font-family="${SANS}" font-size="70" font-weight="700" fill="#B84654">${esc(p.price.display)}</text>`,
    p.mrp.paise > p.price.paise
      ? `<text x="${X}" y="${priceY + 50}" font-family="${SANS}" font-size="32" fill="#93767B" text-decoration="line-through">${esc(p.mrp.display)}</text>`
      : '',
    `<text x="${X}" y="${priceY + 96}" font-family="${SANS}" font-size="24" fill="#624144">Inclusive of GST</text>`,
    // The QR to the product.
    d.qrSvg ? qrGroup(d.qrSvg, X, 580, 240) : '',
    `<text x="${X}" y="${580 + 240 + 38}" font-family="${SANS}" font-size="24" fill="#624144">Scan to see it</text>`,
  ];
  // Footer band.
  body.push(`<rect x="0" y="900" width="${w}" height="180" fill="#341316"/>`);
  if (d.logo) body.push(`<image href="${d.logo}" x="60" y="920" width="140" height="140"/>`);
  body.push(`<text x="${d.logo ? 230 : 60}" y="982" font-family="${SERIF}" font-size="40" font-weight="700" fill="#D9B25A"${fit(`Ask ${d.name}`, 40, 560)}>Ask ${esc(d.name)}</text>`);
  body.push(`<text x="${d.logo ? 230 : 60}" y="1030" font-family="${SANS}" font-size="30" fill="#F7EBEC">Member ID ${esc(d.code)}</text>`);
  body.push(`<text x="${w - 60}" y="1010" text-anchor="end" font-family="${SERIF}" font-size="34" font-weight="700" fill="#F7EBEC">Majestic Cart</text>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="${SANS}">\n${body.filter(Boolean).join('\n')}\n</svg>`;
}

/** A message about one product, with the member's tracked link. */
export function productMessage(p: KitProduct, d: { name: string; link: string }): string {
  const first = d.name.split(' ')[0];
  const deal = off(p) >= 5 ? ` (${off(p)}% off MRP ${p.mrp.display})` : '';
  return `${p.name}${p.brand ? ` by ${p.brand}` : ''} - ${p.price.display}${deal}, delivered to your door.\n${d.link}\n\n- ${first}`;
}

/** The one-tap catalogue: a handful of products with prices and links, then the member's storefront. */
export function catalogueMessage(
  title: string,
  products: { p: KitProduct; link: string }[],
  d: { name: string; storefront: string },
): string {
  const first = d.name.split(' ')[0];
  const lines = products.map(({ p, link }, i) => `${i + 1}. ${p.name} - ${p.price.display}\n${link}`);
  return `${title}\n\n${lines.join('\n\n')}\n\nSee everything here: ${d.storefront}\n\n- ${first}`;
}

export type VideoEmbed =
  | { kind: 'youtube'; id: string }
  | { kind: 'vimeo'; id: string }
  | { kind: 'file'; url: string }
  | { kind: 'link'; url: string };

/** What kind of video link this is, so the page can show it without loading a heavy player up front. */
export function videoEmbed(url: string): VideoEmbed {
  let u: URL;
  try { u = new URL(url); } catch { return { kind: 'link', url }; }
  if (u.protocol !== 'https:') return { kind: 'link', url };
  const host = u.hostname.replace(/^www\./, '');
  if (host === 'youtu.be') { const id = u.pathname.slice(1).split('/')[0]; if (/^[\w-]{6,15}$/.test(id)) return { kind: 'youtube', id }; }
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    const id = u.searchParams.get('v') ?? /^\/(?:embed|shorts)\/([\w-]{6,15})/.exec(u.pathname)?.[1] ?? '';
    if (/^[\w-]{6,15}$/.test(id)) return { kind: 'youtube', id };
  }
  if (host === 'vimeo.com') { const id = u.pathname.split('/').filter(Boolean)[0] ?? ''; if (/^\d+$/.test(id)) return { kind: 'vimeo', id }; }
  if (/\.(mp4|webm)$/i.test(u.pathname)) return { kind: 'file', url };
  return { kind: 'link', url };
}
