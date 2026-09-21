# Majestic Cart — Storefront SEO

Next.js App Router. This covers the rendering map and the three mistakes that
are expensive to undo once the site has been indexed.

---

## 1. What gets indexed, and what does not

**Only the public storefront.** Everything behind the login is `noindex,
nofollow` — wallets, orders, the genealogy tree, the admin console. Indexing
them gains nothing and exposes plenty.

| Route | Rendering | Indexing |
|---|---|---|
| `/` | SSG + ISR (1h) | index, follow |
| `/shop`, `/category/*` | SSG + ISR (1h) | index, follow |
| `/product/*` | SSG + ISR (1h), on-demand for new SKUs | index, follow |
| `/about`, `/faq`, `/contact`, `/join` | SSG | index, follow |
| `/blog/*` | SSG | index, follow |
| `/search` | SSR | **noindex, follow** |
| `/account`, `/wallet`, `/orders`, `/network`, `/cart`, `/recharge` | client | **noindex, nofollow** |
| `/admin/*`, `/reports/*`, `/api/*` | client / server | **noindex, nofollow** |

Search is `noindex, follow` on purpose: a crawler should walk through to the
products, but an unbounded space of query permutations must never enter the
index.

Defence is two-layered. `robotsFor()` sets per-page metadata, and the
middleware sets an `X-Robots-Tag` header for private paths — so a page that
forgets its metadata is still covered.

---

## 2. The referral trap

**This is the one that sinks MLM storefronts.**

Every member shares product links carrying their sponsor ID:

```
/product/rose-gold-body-lotion?ref=MC100002
```

With 500 members that is 500 URLs serving one product. To a crawler they are
500 near-identical pages: link equity splits across the variants and the site
trips duplicate-content handling. The usual outcome is that none of them ranks.

Three parts, all of them needed:

1. **Middleware** reads `?ref`, writes it to a cookie, and `308`-redirects to
   the clean URL. The cookie is set *on the redirect response* — set it after
   and the code is lost in the hop.
2. **Canonical tags** point at the ref-free URL, as a backstop for any variant
   that escapes the redirect.
3. **robots.txt** disallows the parameter, so a referral link discovered in the
   wild costs no crawl budget.

Attribution is unaffected: the cookie carries the sponsor through signup exactly
as the query string did.

Two details that look cosmetic and are not:

- **Parameters are re-emitted in sorted order.** `?sort=price&page=2` and `?page=2&sort=price` are one page; without sorting they are two canonical URLs and the problem comes back in a smaller form.
- **The redirect target must itself be canonical.** If the target still needs cleaning, the 308 bounces forever. There is a test for exactly this.

UTM and click-ID parameters are stripped the same way, for the same reason.

---

## 3. Structured data, and the review trap

`Product`, `Organization` and `BreadcrumbList` only.

**`AggregateRating` is deliberately withheld.** The catalogue ships with seeded
rating and review counts for the demo. Marking those up is fabricated review
data under Google's structured data policies, and the penalty is a manual action
that strips rich results from the **whole domain**, not just the product pages.

`productJsonLd()` refuses to emit ratings unless `verifiedReviews` is present
with a real count — the guard lives in the builder rather than in a code-review
convention, because the failure is silent and one forgetful page is enough.

Once real reviews from verified purchasers exist, populate `verifiedReviews` and
the markup appears on its own.

---

## 4. Income claims

"Earn ₹50,000 a month" on an indexable page is a representation about earnings.
Under the Consumer Protection (Direct Selling) Rules it has to be substantiated,
and a public page is exactly what a regulator reads first.

Everything about income lives behind the login, with the income-distribution
report as its evidence base.

`assertNoIncomeClaims()` runs in CI over page copy so a marketing edit cannot
quietly reintroduce one. It understands English, Bengali and Hindi, including
Indic numerals and the taka sign — an English-only lint would pass a page making
the same claim in Bengali, which is worse than no lint at all because it reads
as coverage.

**It is a lint, not a legal opinion.** It catches blatant phrasings. A clean run
means "nothing obvious", never "approved". Public copy still needs a human read,
and the plan still needs a lawyer who knows direct-selling law.

---

## 5. Performance

Core Web Vitals is a ranking input, and the audience is mid-range Android on
patchy mobile data.

- Product images use `next/image` with `priority` on the LCP element, AVIF/WebP, and explicit `sizes`.
- Storefront pages ship as static HTML from the edge: no database round trip on a cold visit.
- Fonts self-hosted via `next/font` with `display: swap`; no render-blocking Google Fonts request.
- The middleware matcher excludes static assets — redirect logic on every image costs latency and gains nothing.

Budget: LCP under 2.5s and CLS under 0.1 on a throttled 4G Moto G. Measure on
that, not on a laptop.

---

## 6. Still to do

- `app/layout.tsx` with `Organization` JSON-LD and the font setup
- `/category/[slug]` and `/shop` (same template as the product page)
- `hreflang` once Hindi and Bengali copy exists — `en-IN`, `hi-IN`, `bn-IN`, plus `x-default`
- OG image generation via `next/og` so shared links render properly on WhatsApp
- Google Search Console and Bing Webmaster verification
- `/blog` — the only realistic organic-traffic channel for a new D2C beauty brand, since the product names have no search volume yet

---

## 7. Tests

`__tests__/seo.spec.ts` — 29 tests, all passing:

- 500 referral variants of one product collapse to a single canonical URL
- a clean URL is never redirected, and the redirect target is itself canonical
- parameter order does not create a second canonical
- referral codes are validated before ever reaching a cookie
- private paths are noindex; `/accountability` is not treated as `/account`
- seeded demo ratings never become `AggregateRating`; real reviews do
- income claims caught in English, Bengali and Hindi, with no false positives on ordinary price copy

Three real bugs surfaced while writing these: a path with a query string was
matching no prefix and coming back **indexable**, title truncation was one
character over the SERP limit, and the claim lint understood no Bengali at all.
All three were silent failures — which is the argument for the tests.
