/**
 * Interface text in English, Hindi and Bengali.
 *
 * Covers the parts of the site people use every visit - the header and footer,
 * the shop buttons and filters, and the member area's navigation and headings.
 * Product and category names, the home page copy edited in the console, blog posts,
 * legal pages and policies stay in English: they are content, and a translation of a
 * policy is something to be reviewed by the company's lawyer, not added in a rush.
 *
 * Pages stay statically cached, so the language is applied in the browser after
 * the page loads (see LocaleProvider). Search engines read the English page.
 */

export const LOCALES = ['en', 'hi', 'bn'] as const;
export type Locale = (typeof LOCALES)[number];
export const LOCALE_LABEL: Record<Locale, string> = { en: 'EN', hi: 'हिन्दी', bn: 'বাংলা' };
export const LOCALE_NAME: Record<Locale, string> = { en: 'English', hi: 'हिन्दी', bn: 'বাংলা' };
export const LOCALE_HTML_LANG: Record<Locale, string> = { en: 'en-IN', hi: 'hi-IN', bn: 'bn-IN' };

type Row = { en: string; hi: string; bn: string };

export const DICT = {
  // header / footer
  'nav.all': { en: 'All products', hi: 'सभी उत्पाद', bn: 'সব পণ্য' },
  'nav.bag': { en: 'Bag', hi: 'बैग', bn: 'ব্যাগ' },
  'nav.login': { en: 'Log in', hi: 'लॉग इन', bn: 'লগ ইন' },
  'nav.account': { en: 'My account', hi: 'मेरा खाता', bn: 'আমার অ্যাকাউন্ট' },
  'nav.allIn': { en: 'All', hi: 'सभी', bn: 'সব' },
  'footer.shop': { en: 'Shop', hi: 'खरीदारी', bn: 'কেনাকাটা' },
  'footer.company': { en: 'Company', hi: 'कंपनी', bn: 'কোম্পানি' },
  'footer.policies': { en: 'Policies', hi: 'नीतियाँ', bn: 'নীতিমালা' },
  'footer.care': { en: 'Customer care', hi: 'ग्राहक सेवा', bn: 'গ্রাহক সেবা' },
  'footer.grievance': { en: 'Grievance officer', hi: 'शिकायत अधिकारी', bn: 'অভিযোগ কর্মকর্তা' },
  'link.about': { en: 'About us', hi: 'हमारे बारे में', bn: 'আমাদের সম্পর্কে' },
  'link.contact': { en: 'Contact us', hi: 'संपर्क करें', bn: 'যোগাযোগ করুন' },
  'link.join': { en: 'Become a member', hi: 'सदस्य बनें', bn: 'সদস্য হন' },
  'link.faq': { en: 'FAQ', hi: 'अक्सर पूछे जाने वाले प्रश्न', bn: 'সাধারণ প্রশ্ন' },
  'link.privacy': { en: 'Privacy Policy', hi: 'गोपनीयता नीति', bn: 'গোপনীয়তা নীতি' },
  'link.terms': { en: 'Terms and Conditions', hi: 'नियम और शर्तें', bn: 'শর্তাবলী' },
  'link.refund': { en: 'Returns, Refunds and Buy-back', hi: 'वापसी, रिफंड और बायबैक', bn: 'রিটার্ন, রিফান্ড ও বাইব্যাক' },
  'link.shipping': { en: 'Shipping and Delivery', hi: 'शिपिंग और डिलीवरी', bn: 'শিপিং ও ডেলিভারি' },
  // shop
  'shop.addToBag': { en: 'Add to bag', hi: 'बैग में डालें', bn: 'ব্যাগে যোগ করুন' },
  'shop.added': { en: 'Added ✓', hi: 'जुड़ गया ✓', bn: 'যোগ হয়েছে ✓' },
  'shop.byCategory': { en: 'Shop by category', hi: 'श्रेणी के अनुसार खरीदें', bn: 'বিভাগ অনুযায়ী কিনুন' },
  'shop.brands': { en: 'Brands we carry', hi: 'हमारे ब्रांड', bn: 'আমাদের ব্র্যান্ড' },
  'filter.filters': { en: 'Filters', hi: 'फ़िल्टर', bn: 'ফিল্টার' },
  'filter.clear': { en: 'Clear all', hi: 'सब हटाएँ', bn: 'সব মুছুন' },
  'filter.category': { en: 'Category', hi: 'श्रेणी', bn: 'বিভাগ' },
  'filter.brand': { en: 'Brand', hi: 'ब्रांड', bn: 'ব্র্যান্ড' },
  'filter.price': { en: 'Price range (₹)', hi: 'मूल्य सीमा (₹)', bn: 'দামের সীমা (₹)' },
  'filter.bv': { en: 'Business volume (BV)', hi: 'बिज़नेस वॉल्यूम (BV)', bn: 'বিজনেস ভলিউম (BV)' },
  // member area
  'member.overview': { en: 'Overview', hi: 'सारांश', bn: 'ওভারভিউ' },
  'member.wallet': { en: 'Wallet', hi: 'वॉलेट', bn: 'ওয়ালেট' },
  'member.orders': { en: 'Orders', hi: 'ऑर्डर', bn: 'অর্ডার' },
  'member.autoship': { en: 'Autoship', hi: 'ऑटोशिप', bn: 'অটোশিপ' },
  'member.team': { en: 'My team', hi: 'मेरी टीम', bn: 'আমার দল' },
  'member.statement': { en: 'Statement', hi: 'स्टेटमेंट', bn: 'স্টেটমেন্ট' },
  'member.idcard': { en: 'ID card', hi: 'आईडी कार्ड', bn: 'আইডি কার্ড' },
  'member.share': { en: 'Share', hi: 'शेयर करें', bn: 'শেয়ার করুন' },
  'member.support': { en: 'Support', hi: 'सहायता', bn: 'সহায়তা' },
  'member.signout': { en: 'Sign out', hi: 'साइन आउट', bn: 'সাইন আউট' },
  'member.shopping': { en: 'Shopping', hi: 'शॉपिंग', bn: 'শপিং' },
  'member.income': { en: 'Income', hi: 'आय', bn: 'আয়' },
  'member.addMoney': { en: 'Add money', hi: 'पैसे जोड़ें', bn: 'টাকা যোগ করুন' },
  'member.statementLink': { en: 'Statement', hi: 'स्टेटमेंट', bn: 'স্টেটমেন্ট' },
  // ID card page
  'idcard.title': { en: 'Your ID card', hi: 'आपका आईडी कार्ड', bn: 'আপনার আইডি কার্ড' },
  'idcard.photo': { en: 'Your photo', hi: 'आपकी फ़ोटो', bn: 'আপনার ছবি' },
  'idcard.upload': { en: 'Upload photo', hi: 'फ़ोटो अपलोड करें', bn: 'ছবি আপলোড করুন' },
  'idcard.change': { en: 'Change photo', hi: 'फ़ोटो बदलें', bn: 'ছবি বদলান' },
  'idcard.print': { en: 'Print card', hi: 'कार्ड प्रिंट करें', bn: 'কার্ড প্রিন্ট করুন' },
  'idcard.download': { en: 'Download image', hi: 'इमेज डाउनलोड करें', bn: 'ছবি ডাউনলোড করুন' },
  'idcard.design': { en: 'Card design', hi: 'कार्ड डिज़ाइन', bn: 'কার্ডের ডিজাইন' },
  // language
  'lang.label': { en: 'Language', hi: 'भाषा', bn: 'ভাষা' },
} as const satisfies Record<string, Row>;

export type TKey = keyof typeof DICT;

export function translate(key: TKey, locale: Locale): string {
  return DICT[key][locale] ?? DICT[key].en;
}

export const isLocale = (v: unknown): v is Locale => typeof v === 'string' && (LOCALES as readonly string[]).includes(v);
