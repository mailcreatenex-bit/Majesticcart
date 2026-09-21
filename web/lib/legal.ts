/**
 * Legal and policy pages, as structured content.
 *
 * For an Indian direct-selling e-commerce business these pages are not
 * boilerplate — several are mandated, with specific content requirements, by:
 *
 *   • Consumer Protection (E-Commerce) Rules, 2020
 *     legal entity name and address, customer care contact, a named grievance
 *     officer with a resolution timeline, return/refund/exchange terms,
 *     and country of origin for goods.
 *
 *   • Consumer Protection (Direct Selling) Rules, 2021
 *     identifiable direct sellers, published compensation plan details, a
 *     buy-back / return policy, no entry fee, and grievance redressal.
 *
 *   • IT (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021
 *     published terms of use and privacy policy, and a grievance officer.
 *
 *   • Digital Personal Data Protection Act, 2023
 *     notice of purpose, lawful basis, data principal rights, and a contact
 *     for data grievances.
 *
 * So the model below is not "some headings for a policy page". Each document
 * declares the sections the law expects, and `auditDocument()` reports what is
 * missing or still unfilled. That check runs in CI, so the site cannot ship
 * with a half-written refund policy that nobody noticed.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THIS IS SCAFFOLDING, NOT LEGAL ADVICE. The body text below is a drafting
 * starting point written by a developer, not a lawyer. Every one of these
 * documents must be reviewed and completed by a lawyer who knows Indian
 * direct-selling and consumer law before the site goes live. West Bengal also
 * has its own Direct Selling Guidelines (2018) on top of the central Rules.
 * ─────────────────────────────────────────────────────────────────────────
 */

export interface LegalSection {
  id: string;
  heading: string;
  /** Paragraphs. An empty array means the section still needs drafting. */
  body: string[];
  bullets?: string[];
  /** Marks a section whose content is legally prescribed, not optional. */
  statutory?: { basis: string; requirement: string };
  /** Placeholders the business must supply before launch. */
  needs?: string[];
}

export interface LegalDocument {
  slug: string;
  title: string;
  summary: string;
  /** Shown to readers; update whenever the text changes. */
  effectiveFrom: string;
  sections: LegalSection[];
}

/** Filled in from the business's actual registration details before launch. */
export const ENTITY = {
  tradeName: 'Majestic Cart',
  legalName: '[REGISTERED LEGAL NAME]',
  entityType: '[Private Limited / LLP / Proprietorship]',
  cin: '[CIN or registration number]',
  gstin: '[GSTIN]',
  registeredAddress: '[Registered office address, with PIN code]',
  supportEmail: 'care@majesticcart.in',
  supportPhone: '+91 90000 00000',
  supportHours: 'Monday to Saturday, 10am to 7pm IST',
  grievanceOfficer: {
    name: '[GRIEVANCE OFFICER NAME]',
    designation: 'Grievance Officer',
    email: 'grievance@majesticcart.in',
    phone: '[direct number]',
    address: '[address for written complaints]',
  },
} as const;

const TODO = (...needs: string[]) => needs;

/* ------------------------------------------------------------- documents */

export const PRIVACY_POLICY: LegalDocument = {
  slug: 'privacy-policy',
  title: 'Privacy Policy',
  summary: 'What personal data we collect, why we collect it, and the rights you have over it.',
  effectiveFrom: '[DATE]',
  sections: [
    {
      id: 'who-we-are',
      heading: 'Who we are',
      statutory: { basis: 'DPDP Act, 2023 s.5', requirement: 'Identify the Data Fiduciary and give contact details' },
      body: [
        `${ENTITY.tradeName} is operated by ${ENTITY.legalName}, ${ENTITY.entityType}, registered at ${ENTITY.registeredAddress}. For the purposes of the Digital Personal Data Protection Act, 2023, we are the Data Fiduciary for the personal data described in this policy.`,
      ],
      needs: TODO('legal name', 'entity type', 'registered address', 'CIN'),
    },
    {
      id: 'what-we-collect',
      heading: 'What we collect',
      statutory: { basis: 'DPDP Act, 2023 s.5(1)', requirement: 'Itemised notice of the personal data collected' },
      body: ['We collect only what the platform needs to operate:'],
      bullets: [
        'Account details: your name, mobile number, and email address if you give one.',
        'Delivery details: the name, address and phone number you enter for an order.',
        'Payment proof: the UTR and the screenshot you upload when you recharge your wallet. The screenshot is stored so our team can verify the payment against our bank statement.',
        'Payout details: your UPI ID or bank account, used only to send withdrawals. These are encrypted at rest.',
        'Order and wallet history, which we are required to retain for tax and audit purposes.',
        'Sponsor relationship: who introduced you, and who you introduce. This is what your income is calculated from, so it cannot be deleted while your account is active.',
        'Technical data: IP address, device identifier and browser details, used for security and fraud detection.',
      ],
      needs: TODO('confirm whether analytics or advertising cookies are used, and list them'),
    },
    {
      id: 'why-we-collect',
      heading: 'Why we collect it',
      statutory: { basis: 'DPDP Act, 2023 s.4 and s.6', requirement: 'State the specified purpose and the lawful basis for each use' },
      body: [
        'We use your data to run your account, process and deliver your orders, verify payments, calculate and pay commission, meet tax and accounting obligations, and detect fraud.',
        'We do not sell your personal data. We do not use it for advertising by third parties.',
      ],
      needs: TODO('confirm no third-party advertising or data sharing before publishing this'),
    },
    {
      id: 'who-we-share-with',
      heading: 'Who we share it with',
      body: [
        'Delivery partners receive the name, address and phone number needed to deliver your order, and nothing else.',
        'Our payment and hosting providers process data on our instructions under written agreements.',
        'Members of your upline can see your name, member ID and the business volume you generate. They cannot see your address, contact details, payment information or wallet balances.',
        'We disclose data to government authorities only where the law requires it.',
      ],
      needs: TODO('list every processor by name, with their location'),
    },
    {
      id: 'how-long',
      heading: 'How long we keep it',
      body: [
        'Account and transaction records are retained for eight years after your last transaction, to meet Income Tax and GST record-keeping requirements.',
        'Payment screenshots are retained for [PERIOD] after verification and then deleted.',
        'If you close your account, we delete what we are not legally required to keep.',
      ],
      needs: TODO('confirm retention periods with your accountant', 'set the screenshot retention period'),
    },
    {
      id: 'your-rights',
      heading: 'Your rights',
      statutory: { basis: 'DPDP Act, 2023 ss.11-14', requirement: 'Publish the rights of the Data Principal and how to exercise them' },
      body: ['Under the Digital Personal Data Protection Act, 2023 you have the right to:'],
      bullets: [
        'ask what personal data of yours we hold and how we use it',
        'have inaccurate or incomplete data corrected',
        'have data erased where we are not required by law to keep it',
        'nominate someone to exercise these rights if you die or become incapacitated',
        'complain to us, and then to the Data Protection Board of India if you are not satisfied',
      ],
      needs: TODO('set up the process for handling these requests, and the response time you commit to'),
    },
    {
      id: 'security',
      heading: 'How we protect it',
      body: [
        'Passwords are stored using argon2id hashing and are never readable by us or by our staff. Payout bank details are encrypted at rest. Administrative access requires two-factor authentication, and every administrative action affecting money is logged with the user who performed it.',
        'No system is perfectly secure. If a breach affects your data we will notify you and the Data Protection Board as the law requires.',
      ],
    },
    {
      id: 'children',
      heading: 'Children',
      statutory: { basis: 'DPDP Act, 2023 s.9', requirement: 'Verifiable parental consent for users under 18; no tracking or targeted advertising to children' },
      body: [
        'This platform is not intended for anyone under 18. You must be 18 or older to register as a member. We do not knowingly collect data from children, and we do not carry out behavioural tracking or targeted advertising directed at children.',
      ],
    },
    {
      id: 'grievances',
      heading: 'Contacting us about your data',
      statutory: { basis: 'DPDP Act, 2023 s.13 and IT Rules, 2021 r.3(2)', requirement: 'Publish a named grievance contact' },
      body: [
        `Write to ${ENTITY.grievanceOfficer.name}, ${ENTITY.grievanceOfficer.designation}, at ${ENTITY.grievanceOfficer.email}. We acknowledge within 24 hours and aim to resolve within 15 days.`,
      ],
      needs: TODO('appoint a named grievance officer', 'confirm the resolution timeline you can actually meet'),
    },
  ],
};

export const TERMS: LegalDocument = {
  slug: 'terms',
  title: 'Terms and Conditions',
  summary: 'The rules for using Majestic Cart, as a customer and as a direct seller.',
  effectiveFrom: '[DATE]',
  sections: [
    {
      id: 'about-these-terms',
      heading: 'About these terms',
      body: [
        `These terms are between you and ${ENTITY.legalName}, which operates ${ENTITY.tradeName}. By registering or placing an order you accept them.`,
      ],
      needs: TODO('legal name', 'jurisdiction and governing law clause'),
    },
    {
      id: 'joining',
      heading: 'Joining as a direct seller',
      statutory: { basis: 'Consumer Protection (Direct Selling) Rules, 2021 r.5', requirement: 'No entry fee or compulsory purchase of goods as a condition of joining' },
      body: [
        'Registration is free. We do not charge a joining fee, a registration fee, a renewal fee, or any payment as a condition of becoming a member.',
        'To place your first order there is a minimum order value, set out in the compensation plan. This is a purchase of products you keep, not a fee, and it is not payable unless you choose to order.',
        'You must be 18 or older and resident in India.',
      ],
      needs: TODO('have a lawyer confirm the minimum first order is structured as a purchase and not an entry fee'),
    },
    {
      id: 'income',
      heading: 'How income works',
      statutory: { basis: 'Consumer Protection (Direct Selling) Rules, 2021 r.4 and r.7', requirement: 'Publish the compensation plan; income must derive from product sales, not from recruitment' },
      body: [
        'Income is earned only on products that are sold and delivered. No income is paid for recruiting members, and no income is paid on money added to a wallet.',
        'The current rates, ranks, qualification criteria and payout rules are published in full in the compensation plan available in your account.',
        'We make no representation, promise or guarantee about how much you will earn. Earnings depend on sales you and your team actually make. Most members earn modest amounts, and some earn nothing.',
      ],
      needs: TODO('link the published compensation plan', 'publish an income disclosure statement based on actual member earnings'),
    },
    {
      id: 'wallet',
      heading: 'Your wallet',
      body: [
        'The shopping wallet holds money you have added to buy products. It cannot be withdrawn as cash and is not a deposit, a savings product or an investment. It earns no interest.',
        'Money is added only after we verify your payment against our bank statement. If the payment cannot be matched, the request is rejected and you are told why.',
        'The income wallet holds commission you have earned and can be withdrawn subject to the minimum, the deduction and any qualification conditions set out in the compensation plan.',
      ],
      needs: TODO('confirm with your accountant how wallet balances are treated for GST and accounting'),
    },
    {
      id: 'orders-and-pricing',
      heading: 'Orders and pricing',
      statutory: { basis: 'Consumer Protection (E-Commerce) Rules, 2020 r.5', requirement: 'Display total price with a breakdown, and the country of origin of goods' },
      body: [
        'Prices shown include GST. The breakdown appears at checkout and on your invoice.',
        'Country of origin is shown on every product page.',
        'We may decline or cancel an order where a product is out of stock, where a price has been listed in error, or where we suspect fraud. If we cancel, the full amount goes back to your wallet.',
      ],
      needs: TODO('add country of origin to every product record'),
    },
    {
      id: 'conduct',
      heading: 'What members may not do',
      statutory: { basis: 'Consumer Protection (Direct Selling) Rules, 2021 r.7', requirement: 'Prohibit misrepresentation by direct sellers' },
      body: ['As a member representing this business you must not:'],
      bullets: [
        'promise or suggest any specific level of income to anyone',
        'describe joining as an investment, a scheme, or a way to earn without selling',
        'make claims about our products beyond what appears on the product page',
        'create more than one account, or register an account in someone else\'s name',
        'buy products purely to qualify for income rather than to use or sell them',
      ],
    },
    {
      id: 'termination',
      heading: 'Suspension and closure',
      body: [
        'We may suspend or close an account that breaches these terms, that we reasonably suspect of fraud, or where required by law. We will tell you why.',
        'You may close your account at any time. Any verified wallet balance you are entitled to will be settled in line with the refund and payout policies.',
      ],
      needs: TODO('define exactly what happens to each wallet on closure — this needs legal input'),
    },
    {
      id: 'liability',
      heading: 'Our liability',
      body: ['[TO BE DRAFTED BY COUNSEL — limitation of liability, indemnity, force majeure.]'],
      needs: TODO('drafted by a lawyer'),
    },
    {
      id: 'disputes',
      heading: 'Complaints and disputes',
      statutory: { basis: 'Consumer Protection (E-Commerce) Rules, 2020 r.4(5)', requirement: 'Name a grievance officer and publish a resolution timeline' },
      body: [
        `Contact ${ENTITY.grievanceOfficer.name} at ${ENTITY.grievanceOfficer.email}. We acknowledge within 48 hours and aim to resolve within one month.`,
        'Nothing in these terms limits your rights under the Consumer Protection Act, 2019.',
      ],
      needs: TODO('governing law and jurisdiction clause'),
    },
  ],
};

export const REFUND_POLICY: LegalDocument = {
  slug: 'refund-policy',
  title: 'Returns, Refunds and Buy-back',
  summary: 'How to return a product, when you get your money back, and the buy-back rights members have.',
  effectiveFrom: '[DATE]',
  sections: [
    {
      id: 'customer-returns',
      heading: 'Returning a product',
      statutory: { basis: 'Consumer Protection (E-Commerce) Rules, 2020 r.4(3)', requirement: 'Publish return, refund, exchange and warranty terms' },
      body: [
        'You can return a product within [N] days of delivery if it is unopened and in its original packaging, or at any time if it arrived damaged, faulty, or is not what you ordered.',
        'Cosmetics that have been opened cannot be returned for hygiene reasons unless they are faulty.',
      ],
      needs: TODO('set the return window', 'decide who pays return shipping'),
    },
    {
      id: 'refunds',
      heading: 'How refunds are paid',
      body: [
        'An approved refund goes back to the shopping wallet it was paid from, within [N] working days of the returned product reaching us.',
        'Commission already paid on a returned order is reversed across the upline. If that takes an income wallet below zero, the shortfall is recovered from future earnings.',
      ],
      needs: TODO('set the refund processing time', 'decide whether refunds to the original bank account are offered, and on what terms'),
    },
    {
      id: 'buy-back',
      heading: 'Buy-back for members',
      statutory: { basis: 'Consumer Protection (Direct Selling) Rules, 2021 r.5(1)(d)', requirement: 'Offer a buy-back or take-back guarantee for goods bought by a direct seller' },
      body: [
        'If you stop being a member, you can return unsold products that you bought in the previous [N] months, provided they are in resaleable condition. We will buy them back at [PERCENTAGE] of what you paid.',
        'Commission and incentives paid on those products are deducted from the buy-back amount.',
      ],
      needs: TODO('set the buy-back window and percentage — this is a statutory requirement and a lawyer should confirm the terms are compliant'),
    },
    {
      id: 'cancellation',
      heading: 'Cancelling an order',
      body: [
        'You can cancel any time before the order is shipped, from the order page. The full amount returns to your shopping wallet immediately.',
        'Once shipped, an order follows the return process above.',
      ],
    },
  ],
};

export const SHIPPING_POLICY: LegalDocument = {
  slug: 'shipping-policy',
  title: 'Shipping and Delivery',
  summary: 'Where we deliver, how long it takes, and what it costs.',
  effectiveFrom: '[DATE]',
  sections: [
    {
      id: 'coverage',
      heading: 'Where we deliver',
      body: ['We deliver across India to serviceable PIN codes. You can check your PIN code at checkout.'],
      needs: TODO('confirm coverage with your courier partner'),
    },
    {
      id: 'timelines',
      heading: 'How long it takes',
      statutory: { basis: 'Consumer Protection (E-Commerce) Rules, 2020 r.5(3)', requirement: 'Publish delivery timelines' },
      body: ['Orders are dispatched within [N] working days. Delivery usually takes [N] to [N] days depending on your location. You can track your order from the orders page at every stage.'],
      needs: TODO('set realistic dispatch and delivery windows', 'name the courier partner'),
    },
    {
      id: 'charges',
      heading: 'Delivery charges',
      body: ['[State the charge, or the order value above which delivery is free.]'],
      needs: TODO('set delivery charges'),
    },
  ],
};

export const LEGAL_DOCUMENTS: LegalDocument[] = [PRIVACY_POLICY, TERMS, REFUND_POLICY, SHIPPING_POLICY];

export const getLegalDocument = (slug: string): LegalDocument | undefined =>
  LEGAL_DOCUMENTS.find((d) => d.slug === slug);

/* --------------------------------------------------------------- audit */

export interface DocumentAudit {
  slug: string;
  title: string;
  ready: boolean;
  unfilledPlaceholders: { section: string; placeholders: string[] }[];
  emptySections: string[];
  outstandingWork: { section: string; needs: string[] }[];
  statutorySections: { section: string; basis: string; requirement: string }[];
}

/** Anything in [SQUARE BRACKETS] is a placeholder the business must supply. */
const PLACEHOLDER = /\[([^\]]+)\]/g;

export function auditDocument(doc: LegalDocument): DocumentAudit {
  const unfilledPlaceholders: DocumentAudit['unfilledPlaceholders'] = [];
  const emptySections: string[] = [];
  const outstandingWork: DocumentAudit['outstandingWork'] = [];
  const statutorySections: DocumentAudit['statutorySections'] = [];

  const scan = (text: string) => [...text.matchAll(PLACEHOLDER)].map((m) => m[1]);

  if (scan(doc.effectiveFrom).length) {
    unfilledPlaceholders.push({ section: 'Effective date', placeholders: scan(doc.effectiveFrom) });
  }

  for (const section of doc.sections) {
    const text = [...section.body, ...(section.bullets ?? [])].join(' ');
    const found = scan(text);
    if (found.length) unfilledPlaceholders.push({ section: section.heading, placeholders: found });
    if (section.body.length === 0) emptySections.push(section.heading);
    if (section.needs?.length) outstandingWork.push({ section: section.heading, needs: section.needs });
    if (section.statutory) {
      statutorySections.push({ section: section.heading, basis: section.statutory.basis, requirement: section.statutory.requirement });
    }
  }

  return {
    slug: doc.slug,
    title: doc.title,
    ready: unfilledPlaceholders.length === 0 && emptySections.length === 0 && outstandingWork.length === 0,
    unfilledPlaceholders,
    emptySections,
    outstandingWork,
    statutorySections,
  };
}

export const auditAll = (): DocumentAudit[] => LEGAL_DOCUMENTS.map(auditDocument);

/**
 * Fails the build if a legal page would go live with placeholder text in it.
 *
 * Shipping a refund policy that says "within [N] working days" is worse than
 * shipping no policy at all: it reads as a published commitment while promising
 * nothing, and under the E-Commerce Rules it is the published terms that bind.
 */
export function assertLegalPagesReady(): void {
  const notReady = auditAll().filter((a) => !a.ready);
  if (notReady.length === 0) return;
  const detail = notReady
    .map((a) => {
      const bits = [
        a.unfilledPlaceholders.length ? `${a.unfilledPlaceholders.length} section(s) with placeholders` : '',
        a.emptySections.length ? `${a.emptySections.length} empty section(s)` : '',
        a.outstandingWork.length ? `${a.outstandingWork.length} section(s) awaiting business or legal input` : '',
      ].filter(Boolean);
      return `  ${a.title}: ${bits.join(', ')}`;
    })
    .join('\n');
  throw new Error(`Legal pages are not ready to publish:\n${detail}`);
}
