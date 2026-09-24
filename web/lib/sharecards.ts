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
