/**
 * The semantic catalog.
 *
 * Every SQL fragment in this file is authored here, in code, and reviewed like
 * any other code. A report definition can only *reference* these by key — it
 * can never supply SQL of its own.
 *
 * That constraint is the whole security model. The obvious way to build
 * "reports the client can change from the admin panel" is a query box, and that
 * puts every member's PII and every wallet balance one injection away. Here the
 * worst a malicious definition can do is name a key that does not exist, which
 * is a 400.
 *
 * Adding a report is config. Adding a *capability* is a code change, on purpose.
 */

export type FieldType = 'string' | 'number' | 'money' | 'volume' | 'date' | 'enum' | 'percent' | 'duration';

export interface Dimension {
  key: string;
  label: string;
  /** Trusted SQL fragment. Never derived from user input. */
  sql: string;
  type: FieldType;
  /** Date columns can be bucketed by day, week, month or quarter. */
  bucketable?: boolean;
  enumValues?: readonly string[];
  description?: string;
}

export interface Measure {
  key: string;
  label: string;
  /** Trusted aggregate expression. */
  sql: string;
  type: FieldType;
  description?: string;
}

export interface Scoping {
  /** Restrict to rows belonging to one member. Binds $memberId. */
  ownRows: string;
  /** Restrict to a member and everyone beneath them. Binds $pathPrefix. */
  downline: string;
}

export interface Dataset {
  key: string;
  label: string;
  description: string;
  /** Trusted FROM clause including joins. */
  from: string;
  /** Always applied. Keeps cancelled orders out of revenue, and so on. */
  baseWhere?: string;
  dimensions: Record<string, Dimension>;
  measures: Record<string, Measure>;
  /** Absent means the dataset can never be exposed to a member. */
  scoping?: Scoping;
}

/* ------------------------------------------------------------ shared bits */

const RANK_DIM = (alias: string): Dimension => ({
  key: 'rank',
  label: 'Rank',
  sql: `${alias}."rankIndex"`,
  type: 'number',
  description: 'Rank index; resolve names against the active plan version',
});

const MEMBER_DIMS = (alias: string): Record<string, Dimension> => ({
  memberCode: { key: 'memberCode', label: 'Member ID', sql: `${alias}."memberCode"`, type: 'string' },
  memberName: { key: 'memberName', label: 'Member name', sql: `${alias}.name`, type: 'string' },
  rank: RANK_DIM(alias),
  memberStatus: { key: 'memberStatus', label: 'Member status', sql: `${alias}.status::text`, type: 'enum', enumValues: ['ACTIVE', 'ON_HOLD', 'CLOSED'] },
  depth: { key: 'depth', label: 'Depth in tree', sql: `${alias}.depth`, type: 'number' },
});

const MEMBER_SCOPING = (alias: string): Scoping => ({
  ownRows: `${alias}.id = $memberId`,
  // Prefix match, so the btree on ancestorPath is usable. The trailing slash in
  // the prefix is what stops MC100001 matching MC1000012.
  downline: `(${alias}.id = $memberId OR ${alias}."ancestorPath" LIKE $pathPrefix)`,
});

/* ------------------------------------------------------------- datasets */

export const ORDERS: Dataset = {
  key: 'orders',
  label: 'Orders',
  description: 'One row per order. Cancelled orders are excluded unless a filter re-admits them.',
  from: `"Order" o JOIN "Member" m ON m.id = o."memberId"`,
  baseWhere: `o.status <> 'CANCELLED'`,
  dimensions: {
    placedAt: { key: 'placedAt', label: 'Order date', sql: `o."createdAt"`, type: 'date', bucketable: true },
    deliveredAt: { key: 'deliveredAt', label: 'Delivery date', sql: `o."deliveredAt"`, type: 'date', bucketable: true },
    status: { key: 'status', label: 'Status', sql: `o.status::text`, type: 'enum', enumValues: ['PLACED', 'PACKED', 'SHIPPED', 'DELIVERED', 'CANCELLED'] },
    state: { key: 'state', label: 'State', sql: `o."shipState"`, type: 'string' },
    city: { key: 'city', label: 'City', sql: `o."shipCity"`, type: 'string' },
    pincode: { key: 'pincode', label: 'PIN code', sql: `o."shipPincode"`, type: 'string' },
    isFirstPurchase: { key: 'isFirstPurchase', label: 'First order', sql: `o."isFirstPurchase"`, type: 'enum', enumValues: ['true', 'false'] },
    ...MEMBER_DIMS('m'),
  },
  measures: {
    revenue: { key: 'revenue', label: 'Revenue', sql: `COALESCE(SUM(o."totalPaise"), 0)::bigint`, type: 'money' },
    gst: { key: 'gst', label: 'GST collected', sql: `COALESCE(SUM(o."gstPaise"), 0)::bigint`, type: 'money' },
    netOfGst: { key: 'netOfGst', label: 'Revenue net of GST', sql: `COALESCE(SUM(o."subtotalPaise"), 0)::bigint`, type: 'money' },
    bv: { key: 'bv', label: 'Business volume', sql: `COALESCE(SUM(o."totalBvCenti"), 0)::bigint`, type: 'volume' },
    orderCount: { key: 'orderCount', label: 'Orders', sql: `COUNT(*)`, type: 'number' },
    buyerCount: { key: 'buyerCount', label: 'Distinct buyers', sql: `COUNT(DISTINCT o."memberId")`, type: 'number' },
    aov: { key: 'aov', label: 'Average order value', sql: `COALESCE(AVG(o."totalPaise"), 0)::bigint`, type: 'money' },
    // Hours from placement to delivery — the fulfilment SLA.
    fulfilHours: {
      key: 'fulfilHours',
      label: 'Avg hours to deliver',
      sql: `COALESCE(AVG(EXTRACT(EPOCH FROM (o."deliveredAt" - o."createdAt")) / 3600) FILTER (WHERE o."deliveredAt" IS NOT NULL), 0)`,
      type: 'duration',
    },
  },
  scoping: MEMBER_SCOPING('m'),
};

export const ORDER_ITEMS: Dataset = {
  key: 'order_items',
  label: 'Order lines',
  description: 'One row per product per order. Use for category and SKU analysis.',
  from: `"OrderItem" oi
    JOIN "Order" o ON o.id = oi."orderId"
    JOIN "Member" m ON m.id = o."memberId"
    JOIN "Product" p ON p.id = oi."productId"
    JOIN "Category" cat ON cat.id = p."categoryId"`,
  baseWhere: `o.status <> 'CANCELLED'`,
  dimensions: {
    placedAt: { key: 'placedAt', label: 'Order date', sql: `o."createdAt"`, type: 'date', bucketable: true },
    category: { key: 'category', label: 'Category', sql: `cat.name`, type: 'string' },
    sku: { key: 'sku', label: 'SKU', sql: `p.sku`, type: 'string' },
    productName: { key: 'productName', label: 'Product', sql: `p.name`, type: 'string' },
    state: { key: 'state', label: 'State', sql: `o."shipState"`, type: 'string' },
    ...MEMBER_DIMS('m'),
  },
  measures: {
    units: { key: 'units', label: 'Units sold', sql: `COALESCE(SUM(oi.quantity), 0)::bigint`, type: 'number' },
    revenue: { key: 'revenue', label: 'Revenue', sql: `COALESCE(SUM(oi."pricePaise" * oi.quantity), 0)::bigint`, type: 'money' },
    bv: { key: 'bv', label: 'Business volume', sql: `COALESCE(SUM(oi."bvCenti" * oi.quantity), 0)::bigint`, type: 'volume' },
    // Price minus BV: the part of revenue that is NOT committed to commission.
    marginPool: {
      key: 'marginPool',
      label: 'Revenue outside the BV pool',
      sql: `COALESCE(SUM((oi."pricePaise" - oi."bvCenti") * oi.quantity), 0)::bigint`,
      type: 'money',
      description: 'Revenue left after the commissionable portion. Negative means the SKU cannot fund its own payout.',
    },
    lineCount: { key: 'lineCount', label: 'Order lines', sql: `COUNT(*)`, type: 'number' },
  },
  scoping: MEMBER_SCOPING('m'),
};

export const COMMISSION: Dataset = {
  key: 'commission',
  label: 'Commission',
  description: 'One row per payout leg. The basis for every income and compliance report.',
  from: `"Commission" c JOIN "Member" m ON m.id = c."memberId"`,
  dimensions: {
    paidAt: { key: 'paidAt', label: 'Paid on', sql: `c."createdAt"`, type: 'date', bucketable: true },
    type: { key: 'type', label: 'Income type', sql: `c.type::text`, type: 'enum', enumValues: ['SELF', 'DIRECT', 'TEAM', 'GENERATION', 'ROYALTY'] },
    generationLevel: { key: 'generationLevel', label: 'Generation', sql: `c."generationLevel"`, type: 'number' },
    uplineDepth: { key: 'uplineDepth', label: 'Levels above buyer', sql: `c."uplineDepth"`, type: 'number' },
    state: { key: 'state', label: 'Member state', sql: `m.state`, type: 'string' },
    ...MEMBER_DIMS('m'),
  },
  measures: {
    amount: { key: 'amount', label: 'Commission paid', sql: `COALESCE(SUM(c."amountPaise"), 0)::bigint`, type: 'money' },
    legCount: { key: 'legCount', label: 'Payout legs', sql: `COUNT(*)`, type: 'number' },
    earnerCount: { key: 'earnerCount', label: 'Distinct earners', sql: `COUNT(DISTINCT c."memberId")`, type: 'number' },
    avgPerLeg: { key: 'avgPerLeg', label: 'Average per leg', sql: `COALESCE(AVG(c."amountPaise"), 0)::bigint`, type: 'money' },
    medianPerEarner: {
      key: 'medianPerEarner',
      label: 'Median per earner',
      sql: `COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY c."amountPaise"), 0)::bigint`,
      type: 'money',
      description: 'The median matters more than the mean here: a handful of top earners drag the average far above what a typical member sees.',
    },
    p90: { key: 'p90', label: '90th percentile', sql: `COALESCE(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY c."amountPaise"), 0)::bigint`, type: 'money' },
    sourceBv: { key: 'sourceBv', label: 'Volume it was paid on', sql: `COALESCE(SUM(c."sourceBvCenti"), 0)::bigint`, type: 'volume' },
    roundingDust: { key: 'roundingDust', label: 'Rounding remainder', sql: `COALESCE(SUM(c."remainderPaise"), 0)::bigint`, type: 'number' },
  },
  scoping: MEMBER_SCOPING('m'),
};

export const MEMBERS: Dataset = {
  key: 'members',
  label: 'Members',
  description: 'One row per member, with current wallet balances and volumes.',
  from: `"Member" m
    LEFT JOIN "Wallet" ws ON ws."memberId" = m.id AND ws.kind = 'SHOPPING'
    LEFT JOIN "Wallet" wi ON wi."memberId" = m.id AND wi.kind = 'INCOME'
    LEFT JOIN "Member" sp ON sp.id = m."sponsorId"`,
  baseWhere: `m."isCompany" = false`,
  dimensions: {
    joinedAt: { key: 'joinedAt', label: 'Joined on', sql: `m."joinedAt"`, type: 'date', bucketable: true },
    lastLoginAt: { key: 'lastLoginAt', label: 'Last login', sql: `m."lastLoginAt"`, type: 'date', bucketable: true },
    state: { key: 'state', label: 'State', sql: `m.state`, type: 'string' },
    city: { key: 'city', label: 'City', sql: `m.city`, type: 'string' },
    sponsorCode: { key: 'sponsorCode', label: 'Sponsor ID', sql: `sp."memberCode"`, type: 'string' },
    ...MEMBER_DIMS('m'),
  },
  measures: {
    memberCount: { key: 'memberCount', label: 'Members', sql: `COUNT(*)`, type: 'number' },
    shoppingBalance: { key: 'shoppingBalance', label: 'Shopping wallet', sql: `COALESCE(SUM(ws."balancePaise"), 0)::bigint`, type: 'money' },
    incomeBalance: { key: 'incomeBalance', label: 'Income wallet', sql: `COALESCE(SUM(wi."balancePaise"), 0)::bigint`, type: 'money' },
    walletFloat: {
      key: 'walletFloat',
      label: 'Total wallet float',
      sql: `COALESCE(SUM(COALESCE(ws."balancePaise", 0) + COALESCE(wi."balancePaise", 0)), 0)::bigint`,
      type: 'money',
      description: 'Cash already banked against goods not yet delivered. A liability, not revenue.',
    },
    selfBv: { key: 'selfBv', label: 'Own volume', sql: `COALESCE(SUM(m."selfBvCenti"), 0)::bigint`, type: 'volume' },
    groupBv: { key: 'groupBv', label: 'Group volume', sql: `COALESCE(SUM(m."groupBvCenti"), 0)::bigint`, type: 'volume' },
    avgGroupBv: { key: 'avgGroupBv', label: 'Average group volume', sql: `COALESCE(AVG(m."groupBvCenti"), 0)::bigint`, type: 'volume' },
  },
  scoping: MEMBER_SCOPING('m'),
};

export const MONTHLY_VOLUME: Dataset = {
  key: 'monthly_volume',
  label: 'Monthly volume',
  description: 'Per-member volume per month. Drives repurchase-target analysis.',
  from: `"MonthlyVolume" mv JOIN "Member" m ON m.id = mv."memberId"`,
  baseWhere: `m."isCompany" = false`,
  dimensions: {
    period: { key: 'period', label: 'Month', sql: `mv.period`, type: 'string' },
    selfBvBand: {
      key: 'selfBvBand',
      label: 'Volume band',
      // Buckets of 100 BV. A hard spike at exactly the repurchase target means
      // members are buying to unlock withdrawals, not because they want the
      // product — inventory loading, invisible in an average.
      sql: `(FLOOR(mv."selfBvCenti" / 10000) * 100)`,
      type: 'number',
    },
    ...MEMBER_DIMS('m'),
  },
  measures: {
    memberCount: { key: 'memberCount', label: 'Members', sql: `COUNT(*)`, type: 'number' },
    selfBv: { key: 'selfBv', label: 'Own volume', sql: `COALESCE(SUM(mv."selfBvCenti"), 0)::bigint`, type: 'volume' },
    avgSelfBv: { key: 'avgSelfBv', label: 'Average own volume', sql: `COALESCE(AVG(mv."selfBvCenti"), 0)::bigint`, type: 'volume' },
  },
  scoping: MEMBER_SCOPING('m'),
};

export const LEDGER: Dataset = {
  key: 'ledger',
  label: 'Wallet ledger',
  description: 'Every money movement. The audit-grade view.',
  from: `"LedgerEntry" l JOIN "Member" m ON m.id = l."memberId" JOIN "Wallet" w ON w.id = l."walletId"`,
  dimensions: {
    postedAt: { key: 'postedAt', label: 'Posted on', sql: `l."createdAt"`, type: 'date', bucketable: true },
    category: { key: 'category', label: 'Category', sql: `l.category::text`, type: 'string' },
    direction: { key: 'direction', label: 'Direction', sql: `l.direction::text`, type: 'enum', enumValues: ['CREDIT', 'DEBIT'] },
    wallet: { key: 'wallet', label: 'Wallet', sql: `w.kind::text`, type: 'enum', enumValues: ['SHOPPING', 'INCOME'] },
    ...MEMBER_DIMS('m'),
  },
  measures: {
    amount: { key: 'amount', label: 'Amount', sql: `COALESCE(SUM(l."amountPaise"), 0)::bigint`, type: 'money' },
    netAmount: {
      key: 'netAmount',
      label: 'Net movement',
      sql: `COALESCE(SUM(CASE WHEN l.direction = 'CREDIT' THEN l."amountPaise" ELSE -l."amountPaise" END), 0)::bigint`,
      type: 'money',
    },
    entryCount: { key: 'entryCount', label: 'Entries', sql: `COUNT(*)`, type: 'number' },
  },
  scoping: MEMBER_SCOPING('m'),
};

export const RECHARGES: Dataset = {
  key: 'recharges',
  label: 'Recharges',
  description: 'Manual UPI top-ups and their verification history.',
  from: `"Recharge" r JOIN "Member" m ON m.id = r."memberId"`,
  dimensions: {
    submittedAt: { key: 'submittedAt', label: 'Submitted on', sql: `r."createdAt"`, type: 'date', bucketable: true },
    reviewedAt: { key: 'reviewedAt', label: 'Reviewed on', sql: `r."reviewedAt"`, type: 'date', bucketable: true },
    status: { key: 'status', label: 'Status', sql: `r.status::text`, type: 'enum', enumValues: ['PENDING', 'APPROVED', 'REJECTED'] },
    reviewer: { key: 'reviewer', label: 'Reviewed by', sql: `r."reviewedById"`, type: 'string' },
    hasFlags: { key: 'hasFlags', label: 'Flagged', sql: `(COALESCE(ARRAY_LENGTH(r.flags, 1), 0) > 0)`, type: 'enum', enumValues: ['true', 'false'] },
    ...MEMBER_DIMS('m'),
  },
  measures: {
    claimed: { key: 'claimed', label: 'Amount claimed', sql: `COALESCE(SUM(r."claimedPaise"), 0)::bigint`, type: 'money' },
    credited: { key: 'credited', label: 'Amount credited', sql: `COALESCE(SUM(r."creditedPaise"), 0)::bigint`, type: 'money' },
    requestCount: { key: 'requestCount', label: 'Requests', sql: `COUNT(*)`, type: 'number' },
    // Verification is manual, so this is the cost that scales with growth.
    avgReviewMinutes: {
      key: 'avgReviewMinutes',
      label: 'Avg minutes to review',
      sql: `COALESCE(AVG(EXTRACT(EPOCH FROM (r."reviewedAt" - r."createdAt")) / 60) FILTER (WHERE r."reviewedAt" IS NOT NULL), 0)`,
      type: 'duration',
    },
    discrepancy: {
      key: 'discrepancy',
      label: 'Claimed minus credited',
      sql: `COALESCE(SUM(r."claimedPaise" - COALESCE(r."creditedPaise", 0)) FILTER (WHERE r.status = 'APPROVED'), 0)::bigint`,
      type: 'money',
      description: 'Non-zero means members are typing amounts that differ from the bank statement.',
    },
  },
  scoping: MEMBER_SCOPING('m'),
};

export const WITHDRAWALS: Dataset = {
  key: 'withdrawals',
  label: 'Withdrawals',
  description: 'Income payout requests and their outcomes.',
  from: `"Withdrawal" wd JOIN "Member" m ON m.id = wd."memberId"`,
  dimensions: {
    requestedAt: { key: 'requestedAt', label: 'Requested on', sql: `wd."createdAt"`, type: 'date', bucketable: true },
    status: { key: 'status', label: 'Status', sql: `wd.status::text`, type: 'enum', enumValues: ['PENDING', 'PAID', 'REJECTED'] },
    ...MEMBER_DIMS('m'),
  },
  measures: {
    requested: { key: 'requested', label: 'Requested', sql: `COALESCE(SUM(wd."requestedPaise"), 0)::bigint`, type: 'money' },
    deduction: { key: 'deduction', label: 'Deduction withheld', sql: `COALESCE(SUM(wd."deductionPaise"), 0)::bigint`, type: 'money' },
    net: { key: 'net', label: 'Net paid out', sql: `COALESCE(SUM(wd."netPaise"), 0)::bigint`, type: 'money' },
    requestCount: { key: 'requestCount', label: 'Requests', sql: `COUNT(*)`, type: 'number' },
    avgSettleHours: {
      key: 'avgSettleHours',
      label: 'Avg hours to settle',
      sql: `COALESCE(AVG(EXTRACT(EPOCH FROM (wd."reviewedAt" - wd."createdAt")) / 3600) FILTER (WHERE wd."reviewedAt" IS NOT NULL), 0)`,
      type: 'duration',
    },
  },
  scoping: MEMBER_SCOPING('m'),
};

export const ALERTS: Dataset = {
  key: 'alerts',
  label: 'Security alerts',
  description: 'Fraud signals raised by the platform. Admin only — never exposed to members.',
  from: `"SecurityAlert" a`,
  dimensions: {
    raisedAt: { key: 'raisedAt', label: 'Raised on', sql: `a."createdAt"`, type: 'date', bucketable: true },
    severity: { key: 'severity', label: 'Severity', sql: `a.severity`, type: 'enum', enumValues: ['LOW', 'MEDIUM', 'HIGH'] },
    type: { key: 'type', label: 'Signal', sql: `a.type`, type: 'string' },
    resolved: { key: 'resolved', label: 'Resolved', sql: `a.resolved`, type: 'enum', enumValues: ['true', 'false'] },
  },
  measures: {
    alertCount: { key: 'alertCount', label: 'Alerts', sql: `COUNT(*)`, type: 'number' },
    avgResolutionHours: {
      key: 'avgResolutionHours',
      label: 'Avg hours to resolve',
      sql: `COALESCE(AVG(EXTRACT(EPOCH FROM (a."resolvedAt" - a."createdAt")) / 3600) FILTER (WHERE a."resolvedAt" IS NOT NULL), 0)`,
      type: 'duration',
    },
  },
  // No scoping key: this dataset can never be exposed to a member.
};

export const CATALOG: Record<string, Dataset> = {
  [ORDERS.key]: ORDERS,
  [ORDER_ITEMS.key]: ORDER_ITEMS,
  [COMMISSION.key]: COMMISSION,
  [MEMBERS.key]: MEMBERS,
  [MONTHLY_VOLUME.key]: MONTHLY_VOLUME,
  [LEDGER.key]: LEDGER,
  [RECHARGES.key]: RECHARGES,
  [WITHDRAWALS.key]: WITHDRAWALS,
  [ALERTS.key]: ALERTS,
};

export const getDataset = (key: string): Dataset | undefined => CATALOG[key];

/** What the admin UI renders as the field picker. No SQL crosses this line. */
export function describeCatalog() {
  return Object.values(CATALOG).map((d) => ({
    key: d.key,
    label: d.label,
    description: d.description,
    memberSafe: !!d.scoping,
    dimensions: Object.values(d.dimensions).map(({ key, label, type, bucketable, enumValues, description }) => ({
      key, label, type, bucketable: !!bucketable, enumValues, description,
    })),
    measures: Object.values(d.measures).map(({ key, label, type, description }) => ({ key, label, type, description })),
  }));
}
