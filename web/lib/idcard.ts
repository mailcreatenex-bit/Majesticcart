/**
 * ID cards, drawn as SVG.
 *
 * One pure function per design, each returning a self-contained SVG string with
 * every image embedded as a data URL. Self-contained matters: the same string
 * is shown on the page, printed, and drawn onto a canvas to export a PNG, and an
 * SVG that pointed at external files would leave those files out of the export.
 *
 * Which design a member gets is decided by what they have achieved (see
 * `availableVariants`), not chosen freely: a rank card for a rank they have not
 * reached would be a certificate for something untrue.
 */

export type CardVariant = 'welcome' | 'target' | 'rank';

export interface CardData {
  name: string;
  code: string;
  /** "City, State", or null when the member has not saved an address. */
  location: string | null;
  joinedYear: string;
  /** data: URL of the member's photo, or null to draw a placeholder. */
  photo: string | null;
  /** data: URL of the logo. */
  logo: string | null;
  tagline: string;
  rankName: string;
  rankIndex: number;
  /** Month label for the target card, e.g. "September". */
  monthLabel: string;
  /** This month's own purchase volume, e.g. "520". */
  monthBv: string;
  /** The monthly repurchase target, e.g. "500", or null when the plan has none. */
  targetBv: string | null;
}

export const CARD_W = 1000;
export const CARD_H = 1500;

/** The brand's own colours, so the cards belong to the site rather than to a template. */
const NAVY = '#0d2f86';
const RED = '#d81f26';
const GOLD = '#d9b25a';

/** Per-rank metal. Index 0 (Star) is the starting rank and has no rank card. */
const RANK_PALETTE: Record<number, { a: string; b: string; ink: string }> = {
  0: { a: '#f4d58b', b: '#c99a2e', ink: NAVY },
  1: { a: '#e0a26c', b: '#a1602a', ink: '#ffffff' },
  2: { a: '#f3f4f6', b: '#a9b0bb', ink: NAVY },
  3: { a: '#ffe27a', b: '#d19a12', ink: NAVY },
  4: { a: '#bdeeff', b: '#2fa8ea', ink: NAVY },
};
const paletteFor = (i: number) => RANK_PALETTE[Math.min(Math.max(i, 0), 4)] ?? RANK_PALETTE[0];

export function availableVariants(d: { rankIndex: number; rankName: string; monthBvCenti: number; targetBvCenti: number | null }) {
  const out: { variant: CardVariant; label: string }[] = [{ variant: 'welcome', label: 'Welcome' }];
  if (d.targetBvCenti && d.monthBvCenti >= d.targetBvCenti) out.push({ variant: 'target', label: 'Target complete' });
  if (d.rankIndex >= 1) out.push({ variant: 'rank', label: `${d.rankName} rank` });
  return out;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Font size that keeps a name inside its plate: full size up to ~14 characters, then shrinking. */
const nameSize = (name: string, max: number) => Math.max(38, Math.min(max, Math.round(max - Math.max(0, name.length - 14) * 3.2)));

const SCRIPT = "'Segoe Script','Brush Script MT','Lucida Handwriting',cursive";
const SANS = "'Segoe UI',Arial,Helvetica,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";

function open(defs = '') {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${CARD_W} ${CARD_H}" width="${CARD_W}" height="${CARD_H}" font-family="${SANS}">
<defs>
<filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#0b1b4a" flood-opacity="0.28"/></filter>
<linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff0b8"/><stop offset="0.5" stop-color="${GOLD}"/><stop offset="1" stop-color="#a87c26"/></linearGradient>
${defs}
</defs>`;
}

/** A photo in a clipped shape, or a neutral placeholder when none has been uploaded. */
function photoBlock(photo: string | null, clipId: string, x: number, y: number, w: number, h: number, shapeAttrs: string) {
  const shape = (extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${shapeAttrs} ${extra}/>`;
  const inner = photo
    ? `<image href="${photo}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})"/>`
    : `<g clip-path="url(#${clipId})"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#dbe7f3"/>
<circle cx="${x + w / 2}" cy="${y + h * 0.38}" r="${w * 0.19}" fill="#9db4cc"/>
<ellipse cx="${x + w / 2}" cy="${y + h * 0.95}" rx="${w * 0.36}" ry="${h * 0.3}" fill="#9db4cc"/>
<text x="${x + w / 2}" y="${y + h * 0.2}" text-anchor="middle" font-size="40" fill="#6b84a0" font-weight="600">Add your photo</text></g>`;
  return `<clipPath id="${clipId}">${shape()}</clipPath><g filter="url(#sh)">${shape('fill="#ffffff"')}</g>${inner}${shape('fill="none" stroke="#ffffff" stroke-width="10"')}`;
}

function pin(x: number, y: number, s = 1, color = RED) {
  return `<g transform="translate(${x} ${y}) scale(${s})"><path d="M0-70C-38-70-64-42-64-8-64 34 0 92 0 92S64 34 64-8C64-42 38-70 0-70Z" fill="${color}"/><circle cx="0" cy="-10" r="22" fill="#fff"/></g>`;
}

function locationCard(d: CardData, x: number, y: number, w: number, h: number) {
  const parts = (d.location ?? '').split(',').map((p) => p.trim()).filter(Boolean);
  const lines = parts.length ? parts : [`ID ${d.code}`];
  const size = lines.some((l) => l.length > 18) ? 46 : 54;
  const startY = y + h / 2 - ((lines.length - 1) * (size + 8)) / 2 + size * 0.34;
  const text = lines
    .map((l, i) => `<text x="${x + 220}" y="${startY + i * (size + 8)}" font-size="${size}" font-weight="700" fill="${NAVY}">${esc(l)}</text>`)
    .join('');
  return `<g filter="url(#sh)"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="28" fill="#fff" stroke="${RED}" stroke-width="6"/></g>${pin(x + 110, y + h / 2 + 8, 1.1)}${text}`;
}

function logoImg(d: CardData, x: number, y: number, s: number) {
  return d.logo ? `<image href="${d.logo}" x="${x}" y="${y}" width="${s}" height="${s}"/>` : `<text x="${x + s / 2}" y="${y + s / 2}" text-anchor="middle" font-family="${SERIF}" font-size="56" fill="${NAVY}" font-weight="700">Majestic Cart</text>`;
}

function leaves(x: number, y: number, flip = 1) {
  const leaf = (r: number, dx: number, dy: number, s: number) =>
    `<ellipse cx="${x + dx * flip}" cy="${y + dy}" rx="${70 * s}" ry="${34 * s}" transform="rotate(${r * flip} ${x + dx * flip} ${y + dy})" fill="url(#leaf)"/>`;
  return `<g opacity="0.95">${leaf(35, 40, 30, 1.1)}${leaf(70, 90, 80, 1)}${leaf(12, 130, 20, 0.9)}${leaf(52, 20, 110, 0.8)}</g>`;
}

const skyDefs = `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bfe4fb"/><stop offset="0.55" stop-color="#eaf6ff"/><stop offset="1" stop-color="#d9f0ff"/></linearGradient>
<linearGradient id="leaf" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8ddc5a"/><stop offset="1" stop-color="#2f9e3d"/></linearGradient>
<linearGradient id="waveA" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#1f4fc4"/><stop offset="1" stop-color="#0d2f86"/></linearGradient>
<linearGradient id="waveB" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#7cc242"/><stop offset="1" stop-color="#2f9e3d"/></linearGradient>`;

const clouds = `<g fill="#fff" opacity="0.65"><ellipse cx="180" cy="300" rx="180" ry="70"/><ellipse cx="820" cy="760" rx="200" ry="80"/><ellipse cx="300" cy="1180" rx="220" ry="80"/></g>`;

/* ------------------------------------------------------------------ welcome */

function welcome(d: CardData) {
  return `${open(skyDefs)}
<rect width="${CARD_W}" height="${CARD_H}" fill="url(#sky)"/>${clouds}${leaves(10, 10)}${leaves(1010, 60, -1)}
${logoImg(d, 610, 30, 340)}
${photoBlock(d.photo, 'ph', 50, 170, 530, 780, 'rx="44"')}
<text x="592" y="545" font-family="${SCRIPT}" font-size="104" font-weight="700" fill="${RED}" stroke="#fff" stroke-width="9" paint-order="stroke" transform="rotate(-6 592 545)" textLength="375" lengthAdjust="spacingAndGlyphs">Welcome</text>
<text x="600" y="640" font-size="58" font-weight="800" fill="${NAVY}">to the</text>
<text x="600" y="716" font-size="52" font-weight="800" fill="${NAVY}">Majestic Cart</text>
<text x="600" y="786" font-size="58" font-weight="800" fill="${NAVY}">Family</text>
<path d="M600 826q150-40 300-6" stroke="#ff9933" stroke-width="9" fill="none" stroke-linecap="round"/><path d="M620 844q140-30 290-4" stroke="#fff" stroke-width="9" fill="none" stroke-linecap="round"/><path d="M640 862q130-24 260-2" stroke="#2f9e3d" stroke-width="9" fill="none" stroke-linecap="round"/>
<text x="610" y="930" font-family="${SCRIPT}" font-size="38" font-weight="600" fill="${NAVY}" transform="rotate(-8 610 930)">Together for a</text>
<text x="626" y="982" font-family="${SCRIPT}" font-size="38" font-weight="600" fill="${NAVY}" transform="rotate(-8 626 982)">Better Future</text>
<g filter="url(#sh)"><rect x="90" y="925" width="820" height="130" rx="65" fill="${NAVY}" stroke="url(#gold)" stroke-width="7"/></g>
<text x="500" y="${925 + 65 + nameSize(d.name, 74) * 0.34}" text-anchor="middle" font-family="${SERIF}" font-size="${nameSize(d.name, 74)}" font-weight="700" fill="#fff">${esc(d.name)}</text>
${locationCard(d, 90, 1085, 820, 240)}
<path d="M0 1500V1390Q250 1330 520 1390T1000 1370V1500Z" fill="url(#waveA)"/><path d="M0 1500V1430Q300 1380 560 1435T1000 1420V1500Z" fill="url(#waveB)"/><path d="M0 1395Q250 1335 520 1395T1000 1375" stroke="url(#gold)" stroke-width="8" fill="none"/>
<text x="500" y="1470" text-anchor="middle" font-size="34" font-weight="700" fill="#fff" letter-spacing="2">ID ${esc(d.code)}  ·  MEMBER SINCE ${esc(d.joinedYear)}</text>
</svg>`;
}

/* ------------------------------------------------------------------- target */

function trophy(x: number, y: number, s: number) {
  return `<g transform="translate(${x} ${y}) scale(${s})" filter="url(#sh)">
<path d="M-150-10C-215-10-215 120-105 130" stroke="url(#gold)" stroke-width="22" fill="none"/><path d="M150-10C215-10 215 120 105 130" stroke="url(#gold)" stroke-width="22" fill="none"/>
<path d="M-140-20H140C140 150 80 210 20 225V300H-20V225C-80 210-140 150-140-20Z" fill="url(#gold)"/><ellipse cx="0" cy="-20" rx="140" ry="26" fill="#fff0b8"/>
<ellipse cx="0" cy="80" rx="62" ry="62" fill="#fff" opacity="0.9"/><text x="0" y="95" text-anchor="middle" font-size="44" font-weight="800" fill="${NAVY}">MC</text>
<rect x="-90" y="300" width="180" height="34" rx="8" fill="url(#gold)"/><rect x="-140" y="334" width="280" height="80" rx="10" fill="#1a1a2e"/><rect x="-108" y="348" width="216" height="52" rx="6" fill="url(#gold)"/>
<text x="0" y="384" text-anchor="middle" font-size="30" font-weight="800" fill="#1a1a2e">TARGET COMPLETE</text></g>`;
}

function target(d: CardData) {
  const rays = Array.from({ length: 20 }, (_, i) => {
    const a1 = (i / 20) * Math.PI * 2, a2 = ((i + 0.5) / 20) * Math.PI * 2, R = 1800;
    return `<polygon points="500,560 ${500 + Math.cos(a1) * R},${560 + Math.sin(a1) * R} ${500 + Math.cos(a2) * R},${560 + Math.sin(a2) * R}" fill="#fff" opacity="0.13"/>`;
  }).join('');
  const plate = (y: number, label: string, value: string) =>
    `<g filter="url(#sh)"><rect x="50" y="${y}" width="470" height="150" rx="22" fill="${NAVY}" stroke="url(#gold)" stroke-width="7"/></g>
<text x="285" y="${y + 58}" text-anchor="middle" font-size="52" font-weight="800" fill="#fff">${esc(label)}</text>
<text x="285" y="${y + 128}" text-anchor="middle" font-size="84" font-weight="900" fill="#ffd84a">${esc(value)}</text>`;
  return `${open(`<radialGradient id="burst" cx="0.5" cy="0.4" r="0.8"><stop offset="0" stop-color="#8fd8ff"/><stop offset="0.5" stop-color="#2a8de8"/><stop offset="1" stop-color="#0d2f86"/></radialGradient>
<linearGradient id="tRed" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff5a4a"/><stop offset="1" stop-color="#a30f1c"/></linearGradient>
<linearGradient id="tGreen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3fbf5a"/><stop offset="1" stop-color="#0f6b2a"/></linearGradient>`)}
<rect width="${CARD_W}" height="${CARD_H}" fill="url(#burst)"/>${rays}
${Array.from({ length: 18 }, (_, i) => `<path d="M${(i * 173) % 980 + 10} ${(i * 251) % 1400 + 30}l7 18 18 7-18 7-7 18-7-18-18-7 18-7Z" fill="#ffe27a" opacity="0.85"/>`).join('')}
${logoImg(d, 40, 30, 300)}
<path d="M110 372H390" stroke="url(#gold)" stroke-width="5"/><path d="M640 372H890" stroke="url(#gold)" stroke-width="0"/>
<text x="60" y="520" font-size="176" font-weight="900" fill="url(#tRed)" stroke="#fff" stroke-width="8" paint-order="stroke" textLength="440" lengthAdjust="spacingAndGlyphs">TARGET</text>
<text x="50" y="655" font-size="136" font-weight="900" fill="url(#tGreen)" stroke="#fff" stroke-width="8" paint-order="stroke" textLength="455" lengthAdjust="spacingAndGlyphs">COMPLETE</text>
<g filter="url(#sh)"><polygon points="40,700 560,700 590,760 560,820 40,820 70,760" fill="#a30f1c"/></g>
<text x="300" y="783" text-anchor="middle" font-size="64" font-weight="800" fill="#fff" letter-spacing="2">WELL DONE</text>
<text x="70" y="905" font-family="${SCRIPT}" font-size="96" font-weight="700" fill="url(#gold)" stroke="#5b3d0a" stroke-width="2" paint-order="stroke" textLength="430" lengthAdjust="spacingAndGlyphs">Champion!</text>
${plate(940, d.monthLabel, `${d.monthBv} BV`)}
${d.targetBv ? `<text x="285" y="1122" text-anchor="middle" font-size="34" font-weight="700" fill="#fff" opacity="0.92">Monthly target: ${esc(d.targetBv)} BV</text>` : ''}
${photoBlock(d.photo, 'ph', 520, 190, 450, 660, 'rx="225" ry="225"')}
${trophy(700, 960, 0.9)}
<g filter="url(#sh)"><rect x="40" y="1160" width="920" height="200" rx="26" fill="#0b2265" stroke="url(#gold)" stroke-width="7"/></g>
<text x="500" y="1215" text-anchor="middle" font-family="${SCRIPT}" font-size="40" fill="${GOLD}">Name</text>
<text x="500" y="${1215 + nameSize(d.name, 84) * 0.98}" text-anchor="middle" font-family="${SERIF}" font-size="${nameSize(d.name, 84)}" font-weight="700" fill="#fff">${esc(d.name)}</text>
<text x="500" y="1340" text-anchor="middle" font-size="36" font-weight="600" fill="#cfe3ff">${esc(d.location ?? `ID ${d.code}`)}</text>
<text x="500" y="1442" text-anchor="middle" font-family="${SCRIPT}" font-size="104" font-weight="700" fill="${RED}" stroke="#fff" stroke-width="9" paint-order="stroke">Congratulations!</text>
<text x="500" y="1488" text-anchor="middle" font-size="30" font-weight="800" fill="#fff" letter-spacing="3">KEEP GROWING, KEEP SHINING!</text>
<rect x="8" y="8" width="984" height="1484" rx="10" fill="none" stroke="url(#gold)" stroke-width="12"/>
</svg>`;
}

/* --------------------------------------------------------------------- rank */

function rank(d: CardData) {
  const p = paletteFor(d.rankIndex);
  const rankText = d.rankName.toUpperCase();
  return `${open(`${skyDefs}<linearGradient id="metal" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.a}"/><stop offset="1" stop-color="${p.b}"/></linearGradient>`)}
<rect width="${CARD_W}" height="${CARD_H}" fill="url(#sky)"/>${clouds}${leaves(10, 20)}${leaves(1000, 700, -1)}
${logoImg(d, 30, 20, 300)}
<g filter="url(#sh)"><path d="M470 60L960 30 940 190 470 215Z" fill="${NAVY}"/></g>
<text x="710" y="150" text-anchor="middle" font-family="${SCRIPT}" font-size="86" font-weight="700" fill="#ffd84a" transform="rotate(-4 710 150)">New Rank</text>
<text x="715" y="290" text-anchor="middle" font-size="40" font-weight="700" fill="${NAVY}" font-style="italic">Welcome to the next level</text>
<text x="480" y="420" font-family="${SCRIPT}" font-size="84" font-weight="700" fill="${RED}" stroke="#fff" stroke-width="9" paint-order="stroke" textLength="490" lengthAdjust="spacingAndGlyphs">Congratulations</text>
<text x="715" y="490" text-anchor="middle" font-size="58" font-weight="800" fill="${NAVY}">on reaching</text>
<g filter="url(#sh)"><path d="M470 520H960L935 610 960 700H470L495 610Z" fill="url(#metal)" stroke="#fff" stroke-width="5"/></g>
<text x="715" y="640" text-anchor="middle" font-size="${rankText.length > 7 ? 74 : 92}" font-weight="900" fill="${p.ink}">${esc(rankText)}</text>
<text x="715" y="740" text-anchor="middle" font-size="36" font-weight="800" fill="${NAVY}" letter-spacing="6">★ ACHIEVEMENT ★</text>
${photoBlock(d.photo, 'ph', 30, 260, 470, 690, 'rx="40"')}
<g filter="url(#sh)"><path d="M470 800H975V930H470Z" fill="${NAVY}" stroke="url(#gold)" stroke-width="6"/></g>
<text x="722" y="866" text-anchor="middle" font-family="${SERIF}" font-size="${nameSize(d.name, 60) - 6}" font-weight="700" fill="#fff">${esc(d.name)}</text>
<text x="722" y="912" text-anchor="middle" font-size="28" fill="${GOLD}" font-weight="700">ID ${esc(d.code)}</text>
<g filter="url(#sh)"><rect x="470" y="960" width="505" height="150" rx="24" fill="#fff" stroke="${RED}" stroke-width="5"/></g>${pin(535, 1050, 0.62)}
<text x="600" y="1048" font-size="36" font-weight="700" fill="${NAVY}"${(d.location ?? '').length > 17 ? ' textLength="350" lengthAdjust="spacingAndGlyphs"' : ''}>${esc(d.location ?? `Member since ${d.joinedYear}`)}</text>
<g transform="translate(120 975) scale(0.62)" filter="url(#sh)"><ellipse cx="140" cy="250" rx="150" ry="20" fill="#000" opacity="0.12"/>
<path d="M0 0H280C280 170 210 240 160 255V330H120V255C70 240 0 170 0 0Z" fill="url(#metal)"/><rect x="70" y="330" width="140" height="34" rx="6" fill="url(#metal)"/><rect x="30" y="364" width="220" height="60" rx="8" fill="${NAVY}"/><text x="140" y="405" text-anchor="middle" font-size="30" font-weight="800" fill="#fff">${esc(rankText)}</text></g>
<path d="M0 1500V1310Q260 1250 520 1310T1000 1290V1500Z" fill="${NAVY}"/><path d="M0 1310Q260 1250 520 1310T1000 1290" stroke="url(#gold)" stroke-width="8" fill="none"/>
<text x="500" y="1395" text-anchor="middle" font-family="${SCRIPT}" font-size="86" font-weight="700" fill="#ffd84a">Majestic Cart</text>
<text x="500" y="1458" text-anchor="middle" font-size="34" font-weight="700" fill="#fff" letter-spacing="3">${esc(d.tagline.toUpperCase())}</text>
</svg>`;
}

/**
 * Every id in the SVG (gradients, clip paths, the shadow filter) is suffixed per
 * card. Ids are document-global, so two cards on one page would otherwise
 * resolve `url(#ph)` to the first card's clip path and clip the second card's
 * photo to the wrong shape.
 */
export function buildCardSvg(variant: CardVariant, d: CardData): string {
  const raw = variant === 'target' ? target(d) : variant === 'rank' ? rank(d) : welcome(d);
  const u = Math.random().toString(36).slice(2, 7);
  return raw
    .replace(/(\sid=")(\w+)(")/g, (_m, a: string, b: string, c: string) => `${a}${b}-${u}${c}`)
    .replace(/url\(#(\w+)\)/g, (_m, b: string) => `url(#${b}-${u})`);
}
