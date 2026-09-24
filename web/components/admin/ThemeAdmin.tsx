'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { AdminShell, Panel, TableSkeleton } from './AdminShell';
import { ImageUploadField } from './ImageUploadField';

interface ThemeValue {
  colors: { ink: string; accent: string; gold: string };
  logoUrl: string;
  hero: {
    eyebrow: string; title: string; subtitle: string;
    primaryCtaLabel: string; primaryCtaHref: string;
    secondaryCtaLabel: string; secondaryCtaHref: string;
    imageUrl: string;
  };
  announcement: {
    enabled: boolean; text: string; linkLabel: string; linkHref: string;
    couponCode: string; startsOn: string; endsOn: string;
  };
}

const NO_BANNER: ThemeValue['announcement'] = { enabled: false, text: '', linkLabel: '', linkHref: '', couponCode: '', startsOn: '', endsOn: '' };

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
    api<ThemeValue>('/admin/theme').then((v) => setValue({ ...v, announcement: { ...NO_BANNER, ...v.announcement } })).catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load theme settings.'));
  }, []);

  if (error && !value) return <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>;
  if (!value) return <TableSkeleton rows={4} />;

  const setColor = (key: keyof ThemeValue['colors'], v: string) => setValue({ ...value, colors: { ...value.colors, [key]: v } });
  const setBanner = <K extends keyof ThemeValue['announcement']>(key: K, v: ThemeValue['announcement'][K]) => setValue({ ...value, announcement: { ...value.announcement, [key]: v } });
  const setHero = <K extends keyof ThemeValue['hero']>(key: K, v: ThemeValue['hero'][K]) => setValue({ ...value, hero: { ...value.hero, [key]: v } });

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
            <ImageUploadField label="Hero image (optional)" value={value.hero.imageUrl} onChange={(url) => setHero('imageUrl', url)} purpose="theme-asset" hint="Leave blank to keep the plain gradient background." />
          </div>
        </div>
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
