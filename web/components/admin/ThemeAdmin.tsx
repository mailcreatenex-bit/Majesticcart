'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { AdminShell, Panel, TableSkeleton } from './AdminShell';
import { ImageUploadField, ImageGalleryField } from './ImageUploadField';

interface TitleBody { title: string; body: string; image?: string }

const PLAY_COLORS = ['coral', 'teal', 'violet', 'lime', 'pink', 'yellow', 'sky'] as const;
type PlayColorKey = (typeof PLAY_COLORS)[number];

interface ThemeValue {
  colors: { ink: string; accent: string; gold: string };
  logoUrl: string;
  hero: {
    eyebrow: string; title: string; subtitle: string;
    primaryCtaLabel: string; primaryCtaHref: string;
    secondaryCtaLabel: string; secondaryCtaHref: string;
    imageUrls: string[];
  };
  announcement: {
    enabled: boolean; text: string; linkLabel: string; linkHref: string;
    couponCode: string; startsOn: string; endsOn: string;
  };
  promoBanner: {
    enabled: boolean; images: string[]; heading: string; ctaLabel: string; ctaHref: string;
  };
  promoStrip: { images: string[] };
  homeSections: {
    categoriesBg: PlayColorKey; categoriesHeading: string;
    featuredBg: PlayColorKey; featuredHeading: string;
    aboutBg: PlayColorKey;
    exploreBg: PlayColorKey; exploreHeading: string; exploreSubtitle: string;
  };
  trustRibbon: [string, string, string];
  trustBadges: [TitleBody, TitleBody, TitleBody];
  pinkBadges: [TitleBody, TitleBody, TitleBody];
  exploreTiles: [TitleBody, TitleBody, TitleBody, TitleBody, TitleBody, TitleBody, TitleBody];
  aboutUs: { title: string; body: string; images: [string, string] };
  aboutPage: { lead: string; story: string[]; howItWorks: TitleBody[]; notThisTitle: string; notThis: string[] };
  joinPage: { lead: string; steps: TitleBody[]; rules: TitleBody[]; honestTitle: string; honestPoints: string[]; eligibility: string };
  faqPage: { q: string; a: string }[];
}

const NO_BANNER: ThemeValue['announcement'] = { enabled: false, text: '', linkLabel: '', linkHref: '', couponCode: '', startsOn: '', endsOn: '' };
const NO_PROMO: ThemeValue['promoBanner'] = { enabled: true, images: [], heading: '', ctaLabel: '', ctaHref: '/shop' };
const NO_STRIP: ThemeValue['promoStrip'] = { images: [] };
const NO_SECTIONS: ThemeValue['homeSections'] = {
  categoriesBg: 'pink', categoriesHeading: '',
  featuredBg: 'yellow', featuredHeading: '',
  aboutBg: 'violet',
  exploreBg: 'sky', exploreHeading: '', exploreSubtitle: '',
};
const NO_RIBBON: ThemeValue['trustRibbon'] = ['', '', ''];
const EMPTY_TB: TitleBody = { title: '', body: '', image: '' };
const NO_TRUST: ThemeValue['trustBadges'] = [EMPTY_TB, EMPTY_TB, EMPTY_TB];
const NO_PINK: ThemeValue['pinkBadges'] = [EMPTY_TB, EMPTY_TB, EMPTY_TB];
const NO_EXPLORE: ThemeValue['exploreTiles'] = [EMPTY_TB, EMPTY_TB, EMPTY_TB, EMPTY_TB, EMPTY_TB, EMPTY_TB, EMPTY_TB];
const NO_ABOUT: ThemeValue['aboutUs'] = { title: '', body: '', images: ['', ''] };
const EXPLORE_LABELS = ['Shop the range', 'AI shade finder', 'Wallet & recharge', 'Become a member', 'Your network', 'Your account', 'Help & policies'];
const NO_ABOUT_PAGE: ThemeValue['aboutPage'] = { lead: '', story: [''], howItWorks: [EMPTY_TB], notThisTitle: '', notThis: [''] };
const NO_JOIN_PAGE: ThemeValue['joinPage'] = { lead: '', steps: [EMPTY_TB], rules: [EMPTY_TB], honestTitle: '', honestPoints: [''], eligibility: '' };
const NO_FAQ_PAGE: ThemeValue['faqPage'] = [{ q: '', a: '' }];

function mergeTuple<N extends readonly TitleBody[]>(defaults: N, stored: readonly Partial<TitleBody>[] | undefined): N {
  return defaults.map((d, i) => ({ ...d, ...stored?.[i] })) as unknown as N;
}

export function ThemeAdminView() {
  return (
    <AdminShell title="Theme" subtitle="Brand colours and the homepage hero — no deploy needed." permission="theme.manage">
      <Theme />
    </AdminShell>
  );
}

function Theme() {
  const [value, setValue] = useState<ThemeValue | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api<ThemeValue>('/admin/theme')
      .then((v) => setValue({
        ...v,
        announcement: { ...NO_BANNER, ...v.announcement },
        promoBanner: { ...NO_PROMO, ...v.promoBanner },
        promoStrip: { ...NO_STRIP, ...v.promoStrip },
        homeSections: { ...NO_SECTIONS, ...v.homeSections },
        trustRibbon: NO_RIBBON.map((d, i) => v.trustRibbon?.[i] ?? d) as ThemeValue['trustRibbon'],
        trustBadges: mergeTuple(NO_TRUST, v.trustBadges),
        pinkBadges: mergeTuple(NO_PINK, v.pinkBadges),
        exploreTiles: mergeTuple(NO_EXPLORE, v.exploreTiles),
        aboutUs: { ...NO_ABOUT, ...v.aboutUs },
        aboutPage: { ...NO_ABOUT_PAGE, ...v.aboutPage },
        joinPage: { ...NO_JOIN_PAGE, ...v.joinPage },
        faqPage: v.faqPage?.length ? v.faqPage : NO_FAQ_PAGE,
      }))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load theme settings.'));
  }, []);

  if (error && !value) return <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>;
  if (!value) return <TableSkeleton rows={4} />;

  const setColor = (key: keyof ThemeValue['colors'], v: string) => setValue({ ...value, colors: { ...value.colors, [key]: v } });
  const setBanner = <K extends keyof ThemeValue['announcement']>(key: K, v: ThemeValue['announcement'][K]) => setValue({ ...value, announcement: { ...value.announcement, [key]: v } });
  const setHero = <K extends keyof ThemeValue['hero']>(key: K, v: ThemeValue['hero'][K]) => setValue({ ...value, hero: { ...value.hero, [key]: v } });
  const setPromo = <K extends keyof ThemeValue['promoBanner']>(key: K, v: ThemeValue['promoBanner'][K]) => setValue({ ...value, promoBanner: { ...value.promoBanner, [key]: v } });
  const setSection = <K extends keyof ThemeValue['homeSections']>(key: K, v: ThemeValue['homeSections'][K]) => setValue({ ...value, homeSections: { ...value.homeSections, [key]: v } });
  const setAbout = <K extends keyof ThemeValue['aboutUs']>(key: K, v: ThemeValue['aboutUs'][K]) => setValue({ ...value, aboutUs: { ...value.aboutUs, [key]: v } });
  const setTupleItem = <F extends 'trustBadges' | 'pinkBadges' | 'exploreTiles'>(field: F, i: number, patch: Partial<TitleBody>) => {
    const next = [...value[field]] as ThemeValue[F];
    next[i] = { ...next[i], ...patch };
    setValue({ ...value, [field]: next });
  };
  const setRibbon = (i: number, v: string) => {
    const next = [...value.trustRibbon] as ThemeValue['trustRibbon'];
    next[i] = v;
    setValue({ ...value, trustRibbon: next });
  };
  const setAboutPage = <K extends keyof ThemeValue['aboutPage']>(key: K, v: ThemeValue['aboutPage'][K]) => setValue({ ...value, aboutPage: { ...value.aboutPage, [key]: v } });
  const setJoinPage = <K extends keyof ThemeValue['joinPage']>(key: K, v: ThemeValue['joinPage'][K]) => setValue({ ...value, joinPage: { ...value.joinPage, [key]: v } });
  const setFaqPage = (v: ThemeValue['faqPage']) => setValue({ ...value, faqPage: v });

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api('/admin/theme', { method: 'POST', body: value });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save theme settings.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <Panel title="Brand colours">
        <div className="grid gap-4 sm:grid-cols-3">
          <ColorField label="Headings & text" value={value.colors.ink} onChange={(v) => setColor('ink', v)} />
          <ColorField label="Links & buttons" value={value.colors.accent} onChange={(v) => setColor('accent', v)} />
          <ColorField label="Gold accent" value={value.colors.gold} onChange={(v) => setColor('gold', v)} />
        </div>
        <p className="mt-3 text-xs text-neutral-500">Applies to the storefront's light theme. Dark mode keeps its own built-in palette.</p>
      </Panel>

      <Panel title="Logo">
        <ImageUploadField label="Site logo" value={value.logoUrl} onChange={(url) => setValue({ ...value, logoUrl: url })} purpose="theme-asset" />
      </Panel>

      <Panel title="Homepage hero">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Eyebrow" value={value.hero.eyebrow} onChange={(v) => setHero('eyebrow', v)} span2 />
          <label className="block text-sm font-medium text-neutral-800 sm:col-span-2">
            Headline (use a new line for a line break)
            <textarea value={value.hero.title} onChange={(e) => setHero('title', e.target.value)} rows={2} className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none" />
          </label>
          <label className="block text-sm font-medium text-neutral-800 sm:col-span-2">
            Subtitle
            <textarea value={value.hero.subtitle} onChange={(e) => setHero('subtitle', e.target.value)} rows={2} className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none" />
          </label>
          <Field label="Primary button label" value={value.hero.primaryCtaLabel} onChange={(v) => setHero('primaryCtaLabel', v)} />
          <Field label="Primary button link" value={value.hero.primaryCtaHref} onChange={(v) => setHero('primaryCtaHref', v)} />
          <Field label="Secondary button label" value={value.hero.secondaryCtaLabel} onChange={(v) => setHero('secondaryCtaLabel', v)} />
          <Field label="Secondary button link" value={value.hero.secondaryCtaHref} onChange={(v) => setHero('secondaryCtaHref', v)} />
          <div className="sm:col-span-2">
            <ImageGalleryField
              label="Hero photos"
              values={value.hero.imageUrls}
              onChange={(urls) => setHero('imageUrls', urls)}
              purpose="theme-asset"
              max={8}
            />
            <p className="mt-1 text-xs text-neutral-500">
              Two or more auto-rotate on the homepage (~5s each, no arrows). Leave empty to keep the site&apos;s own default photos.
            </p>
          </div>
        </div>
      </Panel>

      <Panel title="Homepage banner">
        <label className="flex items-center gap-2 text-sm font-medium text-neutral-800">
          <input type="checkbox" checked={value.promoBanner.enabled} onChange={(e) => setPromo('enabled', e.target.checked)} className="h-4 w-4" />
          Show the full-width photo banner between the brand grid and the featured products
        </label>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium text-neutral-800 sm:col-span-2">
            Heading
            <textarea value={value.promoBanner.heading} onChange={(e) => setPromo('heading', e.target.value)} rows={2} placeholder="Skin care, makeup and more — picked from brands already on your shelf." className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none" />
          </label>
          <Field label="Button label" value={value.promoBanner.ctaLabel} onChange={(v) => setPromo('ctaLabel', v)} />
          <Field label="Button link" value={value.promoBanner.ctaHref} onChange={(v) => setPromo('ctaHref', v)} />
          <div className="sm:col-span-2">
            <ImageGalleryField
              label="Banner photos"
              values={value.promoBanner.images}
              onChange={(urls) => setPromo('images', urls)}
              purpose="theme-asset"
              max={8}
            />
            <p className="mt-1 text-xs text-neutral-500">Two or more auto-rotate the same way the hero does. Leave empty to keep the default photos.</p>
          </div>
        </div>
      </Panel>

      <Panel title="Promo photo strip">
        <ImageGalleryField
          label="Photos (shown in a row under the brand carousel)"
          values={value.promoStrip.images}
          onChange={(urls) => setValue({ ...value, promoStrip: { images: urls } })}
          purpose="theme-asset"
          max={4}
        />
        <p className="mt-1 text-xs text-neutral-500">Up to four. Shown in one row on desktop, two rows of two on phones.</p>
      </Panel>

      <Panel title="Homepage sections: headings and colours">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Category grid heading" value={value.homeSections.categoriesHeading} onChange={(v) => setSection('categoriesHeading', v)} />
          <ColorSelect label="Category grid background" value={value.homeSections.categoriesBg} onChange={(v) => setSection('categoriesBg', v)} />
          <Field label={'"New this season" heading'} value={value.homeSections.featuredHeading} onChange={(v) => setSection('featuredHeading', v)} />
          <ColorSelect label={'"New this season" background'} value={value.homeSections.featuredBg} onChange={(v) => setSection('featuredBg', v)} />
          <ColorSelect label="About-us background" value={value.homeSections.aboutBg} onChange={(v) => setSection('aboutBg', v)} />
          <div />
          <Field label="Explore-tiles heading" value={value.homeSections.exploreHeading} onChange={(v) => setSection('exploreHeading', v)} />
          <ColorSelect label="Explore-tiles background" value={value.homeSections.exploreBg} onChange={(v) => setSection('exploreBg', v)} />
          <Field label="Explore-tiles subheading" value={value.homeSections.exploreSubtitle} onChange={(v) => setSection('exploreSubtitle', v)} span2 />
        </div>
        <p className="mt-3 text-xs text-neutral-500">Colours are picked from the site's own playful accent palette, so a section always lands on one the rest of the page already uses.</p>
      </Panel>

      <Panel title="Trust ribbon (solid-colour strip under the category grid)">
        <div className="grid gap-3 sm:grid-cols-3">
          {value.trustRibbon.map((label, i) => (
            <Field key={i} label={`Label ${i + 1}`} value={label} onChange={(v) => setRibbon(i, v)} />
          ))}
        </div>
      </Panel>

      <Panel title={'"How this works" strip (dark, near the footer)'}>
        <div className="space-y-4">
          {value.trustBadges.map((b, i) => (
            <div key={i} className="grid gap-3 rounded-lg border border-neutral-200 p-3 sm:grid-cols-2">
              <Field label={`Card ${i + 1} title`} value={b.title} onChange={(v) => setTupleItem('trustBadges', i, { title: v })} />
              <label className="block text-sm font-medium text-neutral-800">
                Card {i + 1} body
                <textarea value={b.body} onChange={(e) => setTupleItem('trustBadges', i, { body: e.target.value })} rows={2} className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none" />
              </label>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Pink trust badges">
        <div className="space-y-4">
          {value.pinkBadges.map((b, i) => (
            <div key={i} className="grid gap-3 rounded-lg border border-neutral-200 p-3 sm:grid-cols-2">
              <Field label={`Badge ${i + 1} title`} value={b.title} onChange={(v) => setTupleItem('pinkBadges', i, { title: v })} />
              <Field label={`Badge ${i + 1} body`} value={b.body} onChange={(v) => setTupleItem('pinkBadges', i, { body: v })} />
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-neutral-500">
          A fourth badge always follows these three, showing the catalogue's live brand and product counts — it isn't editable here, so it can never show a number that's gone stale.
        </p>
      </Panel>

      <Panel title="Explore tiles">
        <div className="space-y-4">
          {value.exploreTiles.map((t, i) => (
            <div key={i} className="rounded-lg border border-neutral-200 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Links to: {EXPLORE_LABELS[i]}</p>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <Field label="Title" value={t.title} onChange={(v) => setTupleItem('exploreTiles', i, { title: v })} />
                <Field label="Body" value={t.body} onChange={(v) => setTupleItem('exploreTiles', i, { body: v })} />
                <div className="sm:col-span-2">
                  <ImageUploadField label="Photo" value={t.image ?? ''} onChange={(url) => setTupleItem('exploreTiles', i, { image: url })} purpose="theme-asset" />
                </div>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-neutral-500">Each tile's destination page is fixed — only its words and photo are editable here.</p>
      </Panel>

      <Panel title="About Majestic Cart section">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Heading" value={value.aboutUs.title} onChange={(v) => setAbout('title', v)} span2 />
          <label className="block text-sm font-medium text-neutral-800 sm:col-span-2">
            Body
            <textarea value={value.aboutUs.body} onChange={(e) => setAbout('body', e.target.value)} rows={4} className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none" />
          </label>
          <ImageUploadField label="Photo 1" value={value.aboutUs.images[0]} onChange={(url) => setAbout('images', [url, value.aboutUs.images[1]])} purpose="theme-asset" />
          <ImageUploadField label="Photo 2" value={value.aboutUs.images[1]} onChange={(url) => setAbout('images', [value.aboutUs.images[0], url])} purpose="theme-asset" />
        </div>
      </Panel>

      <Panel title="About page (/about)">
        <div className="space-y-4">
          <label className="block text-sm font-medium text-neutral-800">
            Lead paragraph (under the page title)
            <textarea value={value.aboutPage.lead} onChange={(e) => setAboutPage('lead', e.target.value)} rows={2} className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none" />
          </label>
          <StringListField label="Story paragraphs" values={value.aboutPage.story} onChange={(v) => setAboutPage('story', v)} max={6} rows={3} />
          <TitleBodyListField label="How the business works — cards" values={value.aboutPage.howItWorks} onChange={(v) => setAboutPage('howItWorks', v)} max={8} />
          <Field label={'"What this is not" heading'} value={value.aboutPage.notThisTitle} onChange={(v) => setAboutPage('notThisTitle', v)} span2 />
          <StringListField label={'"What this is not" points'} values={value.aboutPage.notThis} onChange={(v) => setAboutPage('notThis', v)} max={8} />
        </div>
        <p className="mt-3 text-xs text-neutral-500">
          The site's highest-scrutiny page under the Direct Selling Rules — content is checked for income claims when you save, and the save is rejected with the offending phrase if one is found.
        </p>
      </Panel>

      <Panel title="Join page (/join)">
        <div className="space-y-4">
          <label className="block text-sm font-medium text-neutral-800">
            Lead paragraph
            <textarea value={value.joinPage.lead} onChange={(e) => setJoinPage('lead', e.target.value)} rows={2} className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none" />
          </label>
          <TitleBodyListField label="How it works — numbered steps" values={value.joinPage.steps} onChange={(v) => setJoinPage('steps', v)} max={10} />
          <TitleBodyListField label="The rules we hold ourselves to" values={value.joinPage.rules} onChange={(v) => setJoinPage('rules', v)} max={10} />
          <Field label={'"What this is not" heading'} value={value.joinPage.honestTitle} onChange={(v) => setJoinPage('honestTitle', v)} span2 />
          <StringListField label={'"What this is not" points'} values={value.joinPage.honestPoints} onChange={(v) => setJoinPage('honestPoints', v)} max={8} />
          <label className="block text-sm font-medium text-neutral-800">
            Who can join
            <textarea value={value.joinPage.eligibility} onChange={(e) => setJoinPage('eligibility', e.target.value)} rows={2} className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none" />
          </label>
        </div>
        <p className="mt-3 text-xs text-neutral-500">
          The site's single highest-risk page — the one a regulator reads first when judging whether this is a genuine direct-selling business. Content is checked for income claims when you save.
        </p>
      </Panel>

      <Panel title="FAQ (/faq)">
        <FaqListField values={value.faqPage} onChange={setFaqPage} max={40} />
        <p className="mt-3 text-xs text-neutral-500">Also checked for income claims when you save.</p>
      </Panel>

      <Panel title="Festival banner">
        <label className="flex items-center gap-2 text-sm font-medium text-neutral-800">
          <input type="checkbox" checked={value.announcement.enabled} onChange={(e) => setBanner('enabled', e.target.checked)} className="h-4 w-4" />
          Show a banner across the top of the site
        </label>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Banner text" value={value.announcement.text} onChange={(v) => setBanner('text', v)} span2 />
          <Field label="Coupon code to show (optional)" value={value.announcement.couponCode} onChange={(v) => setBanner('couponCode', v.toUpperCase())} />
          <Field label="Link label (optional)" value={value.announcement.linkLabel} onChange={(v) => setBanner('linkLabel', v)} />
          <Field label="Link address (optional)" value={value.announcement.linkHref} onChange={(v) => setBanner('linkHref', v)} span2 />
          <label className="block text-sm font-medium text-neutral-800">
            Starts on (optional)
            <input type="date" value={value.announcement.startsOn} onChange={(e) => setBanner('startsOn', e.target.value)} className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none" />
          </label>
          <label className="block text-sm font-medium text-neutral-800">
            Ends on (optional)
            <input type="date" value={value.announcement.endsOn} onChange={(e) => setBanner('endsOn', e.target.value)} className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none" />
          </label>
        </div>
        <p className="mt-3 text-xs text-neutral-500">
          Example: “Diwali offer - 10% off your first order” with the code WELCOME10 (create it under Coupons with “first order only”).
          The site is cached for up to an hour, so a banner appears or leaves within the hour of its start or end date.
        </p>
      </Panel>

      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {saved && !error && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">Saved. Changes are live immediately — no deploy needed.</p>}

      <button type="button" onClick={save} disabled={saving} className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white disabled:bg-neutral-300">
        {saving ? 'Saving…' : 'Save theme'}
      </button>
    </div>
  );
}

function Field({ label, value, onChange, span2 }: { label: string; value: string; onChange: (v: string) => void; span2?: boolean }) {
  return (
    <label className={`block text-sm font-medium text-neutral-800 ${span2 ? 'sm:col-span-2' : ''}`}>
      {label}
      <input value={value} onChange={(e) => onChange(e.target.value)} className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none" />
    </label>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-sm font-medium text-neutral-800">
      {label}
      <div className="mt-1.5 flex items-center gap-2">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-9 w-12 shrink-0 rounded border border-neutral-300" />
        <input value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm font-mono focus:border-neutral-900 focus:outline-none" />
      </div>
    </label>
  );
}

function ColorSelect({ label, value, onChange }: { label: string; value: PlayColorKey; onChange: (v: PlayColorKey) => void }) {
  return (
    <label className="block text-sm font-medium text-neutral-800">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value as PlayColorKey)} className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm capitalize focus:border-neutral-900 focus:outline-none">
        {PLAY_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
    </label>
  );
}

function StringListField({ label, values, onChange, max, min = 1, rows = 2 }: { label: string; values: string[]; onChange: (v: string[]) => void; max: number; min?: number; rows?: number }) {
  return (
    <div>
      <p className="text-sm font-medium text-neutral-800">{label}</p>
      <div className="mt-2 space-y-2">
        {values.map((v, i) => (
          <div key={i} className="flex gap-2">
            <textarea
              value={v}
              onChange={(e) => { const next = [...values]; next[i] = e.target.value; onChange(next); }}
              rows={rows}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
            />
            <button type="button" onClick={() => onChange(values.filter((_, j) => j !== i))} disabled={values.length <= min} className="h-fit shrink-0 rounded-lg border border-neutral-300 px-2.5 py-1.5 text-sm text-neutral-600 disabled:opacity-30">✕</button>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => onChange([...values, ''])} disabled={values.length >= max} className="mt-2 rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-700 disabled:opacity-30">+ Add</button>
    </div>
  );
}

function TitleBodyListField({ label, values, onChange, max, min = 1 }: { label: string; values: TitleBody[]; onChange: (v: TitleBody[]) => void; max: number; min?: number }) {
  return (
    <div>
      <p className="text-sm font-medium text-neutral-800">{label}</p>
      <div className="mt-2 space-y-3">
        {values.map((item, i) => (
          <div key={i} className="rounded-lg border border-neutral-200 p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Title" value={item.title} onChange={(v) => { const next = [...values]; next[i] = { ...next[i], title: v }; onChange(next); }} />
              <label className="block text-sm font-medium text-neutral-800">
                Body
                <textarea value={item.body} onChange={(e) => { const next = [...values]; next[i] = { ...next[i], body: e.target.value }; onChange(next); }} rows={2} className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none" />
              </label>
            </div>
            <button type="button" onClick={() => onChange(values.filter((_, j) => j !== i))} disabled={values.length <= min} className="mt-2 rounded-lg border border-neutral-300 px-3 py-1 text-xs font-semibold text-neutral-600 disabled:opacity-30">Remove</button>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => onChange([...values, { title: '', body: '' }])} disabled={values.length >= max} className="mt-2 rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-700 disabled:opacity-30">+ Add</button>
    </div>
  );
}

function FaqListField({ values, onChange, max, min = 1 }: { values: { q: string; a: string }[]; onChange: (v: { q: string; a: string }[]) => void; max: number; min?: number }) {
  return (
    <div>
      <div className="space-y-3">
        {values.map((item, i) => (
          <div key={i} className="rounded-lg border border-neutral-200 p-3">
            <Field label="Question" value={item.q} onChange={(v) => { const next = [...values]; next[i] = { ...next[i], q: v }; onChange(next); }} />
            <label className="mt-3 block text-sm font-medium text-neutral-800">
              Answer
              <textarea value={item.a} onChange={(e) => { const next = [...values]; next[i] = { ...next[i], a: e.target.value }; onChange(next); }} rows={3} className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none" />
            </label>
            <button type="button" onClick={() => onChange(values.filter((_, j) => j !== i))} disabled={values.length <= min} className="mt-2 rounded-lg border border-neutral-300 px-3 py-1 text-xs font-semibold text-neutral-600 disabled:opacity-30">Remove</button>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => onChange([...values, { q: '', a: '' }])} disabled={values.length >= max} className="mt-2 rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-semibold text-neutral-700 disabled:opacity-30">+ Add question</button>
    </div>
  );
}
