// src/__tests__/reporting.spec.ts
import assert from "node:assert/strict";
import { test } from "node:test";

// src/reporting/compiler.ts
import { z } from "zod";
import { BadRequestException, ForbiddenException } from "@nestjs/common";

// src/reporting/catalog.ts
var RANK_DIM = (alias) => ({
  key: "rank",
  label: "Rank",
  sql: `${alias}."rankIndex"`,
  type: "number",
  description: "Rank index; resolve names against the active plan version"
});
var MEMBER_DIMS = (alias) => ({
  memberCode: { key: "memberCode", label: "Member ID", sql: `${alias}."memberCode"`, type: "string" },
  memberName: { key: "memberName", label: "Member name", sql: `${alias}.name`, type: "string" },
  rank: RANK_DIM(alias),
  memberStatus: { key: "memberStatus", label: "Member status", sql: `${alias}.status::text`, type: "enum", enumValues: ["ACTIVE", "ON_HOLD", "CLOSED"] },
  depth: { key: "depth", label: "Depth in tree", sql: `${alias}.depth`, type: "number" }
});
var MEMBER_SCOPING = (alias) => ({
  ownRows: `${alias}.id = $memberId`,
  // Prefix match, so the btree on ancestorPath is usable. The trailing slash in
  // the prefix is what stops MC100001 matching MC1000012.
  downline: `(${alias}.id = $memberId OR ${alias}."ancestorPath" LIKE $pathPrefix)`
});
var ORDERS = {
  key: "orders",
  label: "Orders",
  description: "One row per order. Cancelled orders are excluded unless a filter re-admits them.",
  from: `"Order" o JOIN "Member" m ON m.id = o."memberId"`,
  baseWhere: `o.status <> 'CANCELLED'`,
  dimensions: {
    placedAt: { key: "placedAt", label: "Order date", sql: `o."createdAt"`, type: "date", bucketable: true },
    deliveredAt: { key: "deliveredAt", label: "Delivery date", sql: `o."deliveredAt"`, type: "date", bucketable: true },
    status: { key: "status", label: "Status", sql: `o.status::text`, type: "enum", enumValues: ["PLACED", "PACKED", "SHIPPED", "DELIVERED", "CANCELLED"] },
    state: { key: "state", label: "State", sql: `o."shipState"`, type: "string" },
    city: { key: "city", label: "City", sql: `o."shipCity"`, type: "string" },
    pincode: { key: "pincode", label: "PIN code", sql: `o."shipPincode"`, type: "string" },
    isFirstPurchase: { key: "isFirstPurchase", label: "First order", sql: `o."isFirstPurchase"`, type: "enum", enumValues: ["true", "false"] },
    ...MEMBER_DIMS("m")
  },
  measures: {
    revenue: { key: "revenue", label: "Revenue", sql: `COALESCE(SUM(o."totalPaise"), 0)::bigint`, type: "money" },
    gst: { key: "gst", label: "GST collected", sql: `COALESCE(SUM(o."gstPaise"), 0)::bigint`, type: "money" },
    netOfGst: { key: "netOfGst", label: "Revenue net of GST", sql: `COALESCE(SUM(o."subtotalPaise"), 0)::bigint`, type: "money" },
    bv: { key: "bv", label: "Business volume", sql: `COALESCE(SUM(o."totalBvCenti"), 0)::bigint`, type: "volume" },
    orderCount: { key: "orderCount", label: "Orders", sql: `COUNT(*)`, type: "number" },
    buyerCount: { key: "buyerCount", label: "Distinct buyers", sql: `COUNT(DISTINCT o."memberId")`, type: "number" },
    aov: { key: "aov", label: "Average order value", sql: `COALESCE(AVG(o."totalPaise"), 0)::bigint`, type: "money" },
    // Hours from placement to delivery — the fulfilment SLA.
    fulfilHours: {
      key: "fulfilHours",
      label: "Avg hours to deliver",
      sql: `COALESCE(AVG(EXTRACT(EPOCH FROM (o."deliveredAt" - o."createdAt")) / 3600) FILTER (WHERE o."deliveredAt" IS NOT NULL), 0)`,
      type: "duration"
    }
  },
  scoping: MEMBER_SCOPING("m")
};
var ORDER_ITEMS = {
  key: "order_items",
  label: "Order lines",
  description: "One row per product per order. Use for category and SKU analysis.",
  from: `"OrderItem" oi
    JOIN "Order" o ON o.id = oi."orderId"
    JOIN "Member" m ON m.id = o."memberId"
    JOIN "Product" p ON p.id = oi."productId"
    JOIN "Category" cat ON cat.id = p."categoryId"`,
  baseWhere: `o.status <> 'CANCELLED'`,
  dimensions: {
    placedAt: { key: "placedAt", label: "Order date", sql: `o."createdAt"`, type: "date", bucketable: true },
    category: { key: "category", label: "Category", sql: `cat.name`, type: "string" },
    sku: { key: "sku", label: "SKU", sql: `p.sku`, type: "string" },
    productName: { key: "productName", label: "Product", sql: `p.name`, type: "string" },
    state: { key: "state", label: "State", sql: `o."shipState"`, type: "string" },
    ...MEMBER_DIMS("m")
  },
  measures: {
    units: { key: "units", label: "Units sold", sql: `COALESCE(SUM(oi.quantity), 0)::bigint`, type: "number" },
    revenue: { key: "revenue", label: "Revenue", sql: `COALESCE(SUM(oi."pricePaise" * oi.quantity), 0)::bigint`, type: "money" },
    bv: { key: "bv", label: "Business volume", sql: `COALESCE(SUM(oi."bvCenti" * oi.quantity), 0)::bigint`, type: "volume" },
    // Price minus BV: the part of revenue that is NOT committed to commission.
    marginPool: {
      key: "marginPool",
      label: "Revenue outside the BV pool",
      sql: `COALESCE(SUM((oi."pricePaise" - oi."bvCenti") * oi.quantity), 0)::bigint`,
      type: "money",
      description: "Revenue left after the commissionable portion. Negative means the SKU cannot fund its own payout."
    },
    lineCount: { key: "lineCount", label: "Order lines", sql: `COUNT(*)`, type: "number" }
  },
  scoping: MEMBER_SCOPING("m")
};
var COMMISSION = {
  key: "commission",
  label: "Commission",
  description: "One row per payout leg. The basis for every income and compliance report.",
  from: `"Commission" c JOIN "Member" m ON m.id = c."memberId"`,
  dimensions: {
    paidAt: { key: "paidAt", label: "Paid on", sql: `c."createdAt"`, type: "date", bucketable: true },
    type: { key: "type", label: "Income type", sql: `c.type::text`, type: "enum", enumValues: ["SELF", "DIRECT", "TEAM", "GENERATION", "ROYALTY"] },
    generationLevel: { key: "generationLevel", label: "Generation", sql: `c."generationLevel"`, type: "number" },
    uplineDepth: { key: "uplineDepth", label: "Levels above buyer", sql: `c."uplineDepth"`, type: "number" },
    state: { key: "state", label: "Member state", sql: `m.state`, type: "string" },
    ...MEMBER_DIMS("m")
  },
  measures: {
    amount: { key: "amount", label: "Commission paid", sql: `COALESCE(SUM(c."amountPaise"), 0)::bigint`, type: "money" },
    legCount: { key: "legCount", label: "Payout legs", sql: `COUNT(*)`, type: "number" },
    earnerCount: { key: "earnerCount", label: "Distinct earners", sql: `COUNT(DISTINCT c."memberId")`, type: "number" },
    avgPerLeg: { key: "avgPerLeg", label: "Average per leg", sql: `COALESCE(AVG(c."amountPaise"), 0)::bigint`, type: "money" },
    medianPerEarner: {
      key: "medianPerEarner",
      label: "Median per earner",
      sql: `COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY c."amountPaise"), 0)::bigint`,
      type: "money",
      description: "The median matters more than the mean here: a handful of top earners drag the average far above what a typical member sees."
    },
    p90: { key: "p90", label: "90th percentile", sql: `COALESCE(PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY c."amountPaise"), 0)::bigint`, type: "money" },
    sourceBv: { key: "sourceBv", label: "Volume it was paid on", sql: `COALESCE(SUM(c."sourceBvCenti"), 0)::bigint`, type: "volume" },
    roundingDust: { key: "roundingDust", label: "Rounding remainder", sql: `COALESCE(SUM(c."remainderPaise"), 0)::bigint`, type: "number" }
  },
  scoping: MEMBER_SCOPING("m")
};
var MEMBERS = {
  key: "members",
  label: "Members",
  description: "One row per member, with current wallet balances and volumes.",
  from: `"Member" m
    LEFT JOIN "Wallet" ws ON ws."memberId" = m.id AND ws.kind = 'SHOPPING'
    LEFT JOIN "Wallet" wi ON wi."memberId" = m.id AND wi.kind = 'INCOME'
    LEFT JOIN "Member" sp ON sp.id = m."sponsorId"`,
  baseWhere: `m."isCompany" = false`,
  dimensions: {
    joinedAt: { key: "joinedAt", label: "Joined on", sql: `m."joinedAt"`, type: "date", bucketable: true },
    lastLoginAt: { key: "lastLoginAt", label: "Last login", sql: `m."lastLoginAt"`, type: "date", bucketable: true },
    state: { key: "state", label: "State", sql: `m.state`, type: "string" },
    city: { key: "city", label: "City", sql: `m.city`, type: "string" },
    sponsorCode: { key: "sponsorCode", label: "Sponsor ID", sql: `sp."memberCode"`, type: "string" },
    ...MEMBER_DIMS("m")
  },
  measures: {
    memberCount: { key: "memberCount", label: "Members", sql: `COUNT(*)`, type: "number" },
    shoppingBalance: { key: "shoppingBalance", label: "Shopping wallet", sql: `COALESCE(SUM(ws."balancePaise"), 0)::bigint`, type: "money" },
    incomeBalance: { key: "incomeBalance", label: "Income wallet", sql: `COALESCE(SUM(wi."balancePaise"), 0)::bigint`, type: "money" },
    walletFloat: {
      key: "walletFloat",
      label: "Total wallet float",
      sql: `COALESCE(SUM(COALESCE(ws."balancePaise", 0) + COALESCE(wi."balancePaise", 0)), 0)::bigint`,
      type: "money",
      description: "Cash already banked against goods not yet delivered. A liability, not revenue."
    },
    selfBv: { key: "selfBv", label: "Own volume", sql: `COALESCE(SUM(m."selfBvCenti"), 0)::bigint`, type: "volume" },
    groupBv: { key: "groupBv", label: "Group volume", sql: `COALESCE(SUM(m."groupBvCenti"), 0)::bigint`, type: "volume" },
    avgGroupBv: { key: "avgGroupBv", label: "Average group volume", sql: `COALESCE(AVG(m."groupBvCenti"), 0)::bigint`, type: "volume" }
  },
  scoping: MEMBER_SCOPING("m")
};
var MONTHLY_VOLUME = {
  key: "monthly_volume",
  label: "Monthly volume",
  description: "Per-member volume per month. Drives repurchase-target analysis.",
  from: `"MonthlyVolume" mv JOIN "Member" m ON m.id = mv."memberId"`,
  baseWhere: `m."isCompany" = false`,
  dimensions: {
    period: { key: "period", label: "Month", sql: `mv.period`, type: "string" },
    selfBvBand: {
      key: "selfBvBand",
      label: "Volume band",
      // Buckets of 100 BV. A hard spike at exactly the repurchase target means
      // members are buying to unlock withdrawals, not because they want the
      // product — inventory loading, invisible in an average.
      sql: `(FLOOR(mv."selfBvCenti" / 10000) * 100)`,
      type: "number"
    },
    ...MEMBER_DIMS("m")
  },
  measures: {
    memberCount: { key: "memberCount", label: "Members", sql: `COUNT(*)`, type: "number" },
    selfBv: { key: "selfBv", label: "Own volume", sql: `COALESCE(SUM(mv."selfBvCenti"), 0)::bigint`, type: "volume" },
    avgSelfBv: { key: "avgSelfBv", label: "Average own volume", sql: `COALESCE(AVG(mv."selfBvCenti"), 0)::bigint`, type: "volume" }
  },
  scoping: MEMBER_SCOPING("m")
};
var LEDGER = {
  key: "ledger",
  label: "Wallet ledger",
  description: "Every money movement. The audit-grade view.",
  from: `"LedgerEntry" l JOIN "Member" m ON m.id = l."memberId" JOIN "Wallet" w ON w.id = l."walletId"`,
  dimensions: {
    postedAt: { key: "postedAt", label: "Posted on", sql: `l."createdAt"`, type: "date", bucketable: true },
    category: { key: "category", label: "Category", sql: `l.category::text`, type: "string" },
    direction: { key: "direction", label: "Direction", sql: `l.direction::text`, type: "enum", enumValues: ["CREDIT", "DEBIT"] },
    wallet: { key: "wallet", label: "Wallet", sql: `w.kind::text`, type: "enum", enumValues: ["SHOPPING", "INCOME"] },
    ...MEMBER_DIMS("m")
  },
  measures: {
    amount: { key: "amount", label: "Amount", sql: `COALESCE(SUM(l."amountPaise"), 0)::bigint`, type: "money" },
    netAmount: {
      key: "netAmount",
      label: "Net movement",
      sql: `COALESCE(SUM(CASE WHEN l.direction = 'CREDIT' THEN l."amountPaise" ELSE -l."amountPaise" END), 0)::bigint`,
      type: "money"
    },
    entryCount: { key: "entryCount", label: "Entries", sql: `COUNT(*)`, type: "number" }
  },
  scoping: MEMBER_SCOPING("m")
};
var RECHARGES = {
  key: "recharges",
  label: "Recharges",
  description: "Manual UPI top-ups and their verification history.",
  from: `"Recharge" r JOIN "Member" m ON m.id = r."memberId"`,
  dimensions: {
    submittedAt: { key: "submittedAt", label: "Submitted on", sql: `r."createdAt"`, type: "date", bucketable: true },
    reviewedAt: { key: "reviewedAt", label: "Reviewed on", sql: `r."reviewedAt"`, type: "date", bucketable: true },
    status: { key: "status", label: "Status", sql: `r.status::text`, type: "enum", enumValues: ["PENDING", "APPROVED", "REJECTED"] },
    reviewer: { key: "reviewer", label: "Reviewed by", sql: `r."reviewedById"`, type: "string" },
    hasFlags: { key: "hasFlags", label: "Flagged", sql: `(COALESCE(ARRAY_LENGTH(r.flags, 1), 0) > 0)`, type: "enum", enumValues: ["true", "false"] },
    ...MEMBER_DIMS("m")
  },
  measures: {
    claimed: { key: "claimed", label: "Amount claimed", sql: `COALESCE(SUM(r."claimedPaise"), 0)::bigint`, type: "money" },
    credited: { key: "credited", label: "Amount credited", sql: `COALESCE(SUM(r."creditedPaise"), 0)::bigint`, type: "money" },
    requestCount: { key: "requestCount", label: "Requests", sql: `COUNT(*)`, type: "number" },
    // Verification is manual, so this is the cost that scales with growth.
    avgReviewMinutes: {
      key: "avgReviewMinutes",
      label: "Avg minutes to review",
      sql: `COALESCE(AVG(EXTRACT(EPOCH FROM (r."reviewedAt" - r."createdAt")) / 60) FILTER (WHERE r."reviewedAt" IS NOT NULL), 0)`,
      type: "duration"
    },
    discrepancy: {
      key: "discrepancy",
      label: "Claimed minus credited",
      sql: `COALESCE(SUM(r."claimedPaise" - COALESCE(r."creditedPaise", 0)) FILTER (WHERE r.status = 'APPROVED'), 0)::bigint`,
      type: "money",
      description: "Non-zero means members are typing amounts that differ from the bank statement."
    }
  },
  scoping: MEMBER_SCOPING("m")
};
var WITHDRAWALS = {
  key: "withdrawals",
  label: "Withdrawals",
  description: "Income payout requests and their outcomes.",
  from: `"Withdrawal" wd JOIN "Member" m ON m.id = wd."memberId"`,
  dimensions: {
    requestedAt: { key: "requestedAt", label: "Requested on", sql: `wd."createdAt"`, type: "date", bucketable: true },
    status: { key: "status", label: "Status", sql: `wd.status::text`, type: "enum", enumValues: ["PENDING", "PAID", "REJECTED"] },
    ...MEMBER_DIMS("m")
  },
  measures: {
    requested: { key: "requested", label: "Requested", sql: `COALESCE(SUM(wd."requestedPaise"), 0)::bigint`, type: "money" },
    deduction: { key: "deduction", label: "Deduction withheld", sql: `COALESCE(SUM(wd."deductionPaise"), 0)::bigint`, type: "money" },
    net: { key: "net", label: "Net paid out", sql: `COALESCE(SUM(wd."netPaise"), 0)::bigint`, type: "money" },
    requestCount: { key: "requestCount", label: "Requests", sql: `COUNT(*)`, type: "number" },
    avgSettleHours: {
      key: "avgSettleHours",
      label: "Avg hours to settle",
      sql: `COALESCE(AVG(EXTRACT(EPOCH FROM (wd."reviewedAt" - wd."createdAt")) / 3600) FILTER (WHERE wd."reviewedAt" IS NOT NULL), 0)`,
      type: "duration"
    }
  },
  scoping: MEMBER_SCOPING("m")
};
var ALERTS = {
  key: "alerts",
  label: "Security alerts",
  description: "Fraud signals raised by the platform. Admin only \u2014 never exposed to members.",
  from: `"SecurityAlert" a`,
  dimensions: {
    raisedAt: { key: "raisedAt", label: "Raised on", sql: `a."createdAt"`, type: "date", bucketable: true },
    severity: { key: "severity", label: "Severity", sql: `a.severity`, type: "enum", enumValues: ["LOW", "MEDIUM", "HIGH"] },
    type: { key: "type", label: "Signal", sql: `a.type`, type: "string" },
    resolved: { key: "resolved", label: "Resolved", sql: `a.resolved`, type: "enum", enumValues: ["true", "false"] }
  },
  measures: {
    alertCount: { key: "alertCount", label: "Alerts", sql: `COUNT(*)`, type: "number" },
    avgResolutionHours: {
      key: "avgResolutionHours",
      label: "Avg hours to resolve",
      sql: `COALESCE(AVG(EXTRACT(EPOCH FROM (a."resolvedAt" - a."createdAt")) / 3600) FILTER (WHERE a."resolvedAt" IS NOT NULL), 0)`,
      type: "duration"
    }
  }
  // No scoping key: this dataset can never be exposed to a member.
};
var CATALOG = {
  [ORDERS.key]: ORDERS,
  [ORDER_ITEMS.key]: ORDER_ITEMS,
  [COMMISSION.key]: COMMISSION,
  [MEMBERS.key]: MEMBERS,
  [MONTHLY_VOLUME.key]: MONTHLY_VOLUME,
  [LEDGER.key]: LEDGER,
  [RECHARGES.key]: RECHARGES,
  [WITHDRAWALS.key]: WITHDRAWALS,
  [ALERTS.key]: ALERTS
};
var getDataset = (key) => CATALOG[key];
function describeCatalog() {
  return Object.values(CATALOG).map((d) => ({
    key: d.key,
    label: d.label,
    description: d.description,
    memberSafe: !!d.scoping,
    dimensions: Object.values(d.dimensions).map(({ key, label, type, bucketable, enumValues, description }) => ({
      key,
      label,
      type,
      bucketable: !!bucketable,
      enumValues,
      description
    })),
    measures: Object.values(d.measures).map(({ key, label, type, description }) => ({ key, label, type, description }))
  }));
}

// src/reporting/compiler.ts
var FILTER_OPS = ["eq", "neq", "in", "notIn", "gt", "gte", "lt", "lte", "between", "contains", "isNull", "notNull"];
var BUCKETS = ["day", "week", "month", "quarter", "year"];
var CHART_TYPES = ["table", "line", "bar", "stackedBar", "area", "pie", "funnel", "histogram", "heatmap", "sankey", "scorecard"];
var AUDIENCES = ["ADMIN", "FINANCE", "SUPPORT", "MEMBER"];
var MAX_ROWS = 5e3;
var MAX_DIMENSIONS = 4;
var MAX_MEASURES = 8;
var FilterSchema = z.object({
  dimension: z.string().min(1),
  op: z.enum(FILTER_OPS),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]).optional()
});
var ReportDefinitionSchema = z.object({
  key: z.string().regex(/^[a-z0-9_]+$/, "Use lowercase letters, numbers and underscores"),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(400).optional(),
  dataset: z.string().min(1),
  dimensions: z.array(z.string()).max(MAX_DIMENSIONS),
  /** Applied to the first bucketable dimension. */
  bucket: z.enum(BUCKETS).optional(),
  measures: z.array(z.string()).min(1).max(MAX_MEASURES),
  filters: z.array(FilterSchema).max(12).default([]),
  sort: z.object({ field: z.string(), direction: z.enum(["asc", "desc"]) }).optional(),
  limit: z.number().int().min(1).max(MAX_ROWS).default(500),
  chartType: z.enum(CHART_TYPES).default("table"),
  audience: z.array(z.enum(AUDIENCES)).min(1),
  /**
   * Advisory only. A MEMBER caller is scoped to their own downline whatever
   * this says; see compile().
   */
  scope: z.enum(["GLOBAL", "OWN_DOWNLINE", "OWN_ROWS"]).default("GLOBAL"),
  schedule: z.object({ cron: z.string().min(5).max(60), recipients: z.array(z.string().email()).max(20) }).optional()
}).superRefine((def2, ctx) => {
  const fail = (path, message) => ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });
  const ds = getDataset(def2.dataset);
  if (!ds) {
    fail(["dataset"], `Unknown dataset "${def2.dataset}". Available: ${Object.keys(CATALOG).join(", ")}`);
    return;
  }
  def2.dimensions.forEach((d, i) => {
    if (!ds.dimensions[d]) fail(["dimensions", i], `"${d}" is not a dimension of ${ds.key}`);
  });
  def2.measures.forEach((m, i) => {
    if (!ds.measures[m]) fail(["measures", i], `"${m}" is not a measure of ${ds.key}`);
  });
  def2.filters.forEach((f, i) => {
    if (!ds.dimensions[f.dimension]) fail(["filters", i, "dimension"], `"${f.dimension}" is not a dimension of ${ds.key}`);
    const needsValue = !["isNull", "notNull"].includes(f.op);
    if (needsValue && f.value === void 0) fail(["filters", i, "value"], `"${f.op}" needs a value`);
    if (f.op === "between" && (!Array.isArray(f.value) || f.value.length !== 2)) {
      fail(["filters", i, "value"], '"between" needs exactly two values');
    }
    if ((f.op === "in" || f.op === "notIn") && (!Array.isArray(f.value) || f.value.length === 0)) {
      fail(["filters", i, "value"], `"${f.op}" needs a non-empty list`);
    }
  });
  if (def2.sort && !ds.dimensions[def2.sort.field] && !ds.measures[def2.sort.field] && !def2.measures.includes(def2.sort.field)) {
    fail(["sort", "field"], `"${def2.sort.field}" is neither a dimension nor a selected measure`);
  }
  if (def2.bucket && !def2.dimensions.some((d) => ds.dimensions[d]?.bucketable)) {
    fail(["bucket"], "A bucket needs a date dimension in the report");
  }
  if (def2.audience.includes("MEMBER") && !ds.scoping) {
    fail(["audience"], `${ds.label} has no member scoping and cannot be shown to members`);
  }
});
var Params = class {
  values = [];
  bind(value) {
    this.values.push(value);
    return `$${this.values.length}`;
  }
};
function compile(def2, caller) {
  const ds = getDataset(def2.dataset);
  if (!ds) throw new BadRequestException(`Unknown dataset "${def2.dataset}"`);
  if (caller.type === "MEMBER" && !def2.audience.includes("MEMBER")) {
    throw new ForbiddenException("This report is not available to members.");
  }
  if (caller.type === "ADMIN") {
    const staffAudiences = def2.audience.filter((a) => a !== "MEMBER");
    const isMemberOnly = staffAudiences.length === 0;
    if (isMemberOnly && !caller.onBehalfOf) {
      throw new ForbiddenException("This is a member report. Choose which member to view it for.");
    }
    if (!isMemberOnly && caller.role && !staffAudiences.includes(caller.role)) {
      throw new ForbiddenException("Your role does not have access to this report.");
    }
  }
  const p = new Params();
  const selects = [];
  const groupBys = [];
  const columns = [];
  for (const key of def2.dimensions) {
    const dim = ds.dimensions[key];
    if (!dim) throw new BadRequestException(`"${key}" is not a dimension of ${ds.key}`);
    const expr = dim.bucketable && def2.bucket ? `date_trunc('${assertBucket(def2.bucket)}', ${dim.sql})` : dim.sql;
    selects.push(`${expr} AS ${quoteIdent(key)}`);
    groupBys.push(expr);
    columns.push({ key, label: dim.label, type: dim.type, role: "dimension" });
  }
  for (const key of def2.measures) {
    const measure = ds.measures[key];
    if (!measure) throw new BadRequestException(`"${key}" is not a measure of ${ds.key}`);
    selects.push(`${measure.sql} AS ${quoteIdent(key)}`);
    columns.push({ key, label: measure.label, type: measure.type, role: "measure" });
  }
  const wheres = [];
  if (ds.baseWhere) wheres.push(`(${ds.baseWhere})`);
  for (const f of def2.filters) {
    const dim = ds.dimensions[f.dimension];
    if (!dim) throw new BadRequestException(`"${f.dimension}" is not a dimension of ${ds.key}`);
    wheres.push(renderFilter(dim, f, p));
  }
  const scopeApplied = applyScope(ds, def2, caller, wheres, p);
  const sql = [
    `SELECT ${selects.join(", ")}`,
    `FROM ${ds.from}`,
    wheres.length ? `WHERE ${wheres.join(" AND ")}` : "",
    groupBys.length ? `GROUP BY ${groupBys.join(", ")}` : "",
    renderOrderBy(def2, ds),
    `LIMIT ${Math.min(def2.limit ?? 500, MAX_ROWS)}`
  ].filter(Boolean).join("\n");
  return { sql, params: p.values, columns, scopeApplied };
}
function applyScope(ds, def2, caller, wheres, p) {
  if (caller.type === "ADMIN" && !caller.onBehalfOf) {
    return def2.scope === "GLOBAL" ? "GLOBAL" : def2.scope;
  }
  const subject = caller.type === "ADMIN" ? caller.onBehalfOf : { memberId: caller.memberId, ancestorPath: caller.ancestorPath };
  if (!ds.scoping) throw new ForbiddenException("This data is not available to members.");
  if (!subject.memberId || subject.ancestorPath === void 0) {
    throw new ForbiddenException("Member context is missing; refusing to run an unscoped query.");
  }
  if (def2.scope === "OWN_ROWS") {
    wheres.push(`(${ds.scoping.ownRows.replace("$memberId", p.bind(subject.memberId))})`);
    return "OWN_ROWS";
  }
  const prefix = `${subject.ancestorPath}${subject.memberId}/%`;
  const predicate = ds.scoping.downline.replace("$memberId", p.bind(subject.memberId)).replace("$pathPrefix", p.bind(prefix));
  wheres.push(`(${predicate})`);
  return "OWN_DOWNLINE";
}
function renderFilter(dim, f, p) {
  const col = dim.sql;
  switch (f.op) {
    case "eq":
      return `${col} = ${p.bind(coerce(dim, f.value))}`;
    case "neq":
      return `${col} <> ${p.bind(coerce(dim, f.value))}`;
    case "gt":
      return `${col} > ${p.bind(coerce(dim, f.value))}`;
    case "gte":
      return `${col} >= ${p.bind(coerce(dim, f.value))}`;
    case "lt":
      return `${col} < ${p.bind(coerce(dim, f.value))}`;
    case "lte":
      return `${col} <= ${p.bind(coerce(dim, f.value))}`;
    case "between": {
      const [a, b] = f.value;
      return `${col} BETWEEN ${p.bind(coerce(dim, a))} AND ${p.bind(coerce(dim, b))}`;
    }
    case "in": {
      const list = f.value.map((v) => p.bind(coerce(dim, v)));
      return `${col} IN (${list.join(", ")})`;
    }
    case "notIn": {
      const list = f.value.map((v) => p.bind(coerce(dim, v)));
      return `${col} NOT IN (${list.join(", ")})`;
    }
    case "contains":
      return `${col}::text ILIKE ${p.bind(`%${String(f.value)}%`)}`;
    case "isNull":
      return `${col} IS NULL`;
    case "notNull":
      return `${col} IS NOT NULL`;
    default: {
      const never = f.op;
      throw new BadRequestException(`Unsupported filter operator "${never}"`);
    }
  }
}
function coerce(dim, value) {
  if (dim.enumValues && (value === "true" || value === "false")) return value === "true";
  if (dim.type === "date" && typeof value === "string") {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) throw new BadRequestException(`"${value}" is not a valid date`);
    return d;
  }
  return value;
}
function renderOrderBy(def2, ds) {
  if (def2.sort) {
    const known = ds.dimensions[def2.sort.field] ?? ds.measures[def2.sort.field];
    if (!known) throw new BadRequestException(`Cannot sort by "${def2.sort.field}"`);
    return `ORDER BY ${quoteIdent(def2.sort.field)} ${def2.sort.direction === "asc" ? "ASC" : "DESC"}`;
  }
  if (def2.dimensions.length) return `ORDER BY ${quoteIdent(def2.dimensions[0])} ASC`;
  return "";
}
function assertBucket(bucket) {
  if (!BUCKETS.includes(bucket)) throw new BadRequestException(`Unsupported bucket "${bucket}"`);
  return bucket;
}
function quoteIdent(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new BadRequestException(`Unsafe identifier "${name}"`);
  return `"${name.replace(/"/g, '""')}"`;
}
function parseDefinition(raw) {
  return ReportDefinitionSchema.parse(raw);
}

// src/reporting/presets.ts
var define = (d) => d;
var FINANCE_REPORTS = [
  define({
    key: "revenue_trend",
    name: "Revenue and volume trend",
    description: "Monthly revenue, business volume and order count.",
    dataset: "orders",
    dimensions: ["placedAt"],
    bucket: "month",
    measures: ["revenue", "bv", "orderCount", "aov"],
    filters: [],
    limit: 36,
    chartType: "line",
    audience: ["ADMIN", "FINANCE"],
    scope: "GLOBAL"
  }),
  define({
    key: "commission_liability",
    name: "Commission liability by month",
    description: "What the plan actually paid out, split by income type. Read alongside revenue to watch the payout ratio.",
    dataset: "commission",
    dimensions: ["paidAt", "type"],
    bucket: "month",
    measures: ["amount", "legCount", "earnerCount"],
    filters: [],
    limit: 300,
    chartType: "stackedBar",
    audience: ["ADMIN", "FINANCE"],
    scope: "GLOBAL"
  }),
  define({
    key: "wallet_float",
    name: "Wallet float by rank",
    description: "Member money held on the platform. This is a liability against goods not yet delivered, not revenue.",
    dataset: "members",
    dimensions: ["rank"],
    measures: ["memberCount", "shoppingBalance", "incomeBalance", "walletFloat"],
    filters: [{ dimension: "memberStatus", op: "eq", value: "ACTIVE" }],
    limit: 20,
    chartType: "bar",
    audience: ["ADMIN", "FINANCE"],
    scope: "GLOBAL"
  }),
  define({
    key: "gst_by_month",
    name: "GST collected by month",
    description: "Tax component of delivered orders, for the monthly return.",
    dataset: "orders",
    dimensions: ["placedAt"],
    bucket: "month",
    measures: ["netOfGst", "gst", "revenue", "orderCount"],
    filters: [{ dimension: "status", op: "eq", value: "DELIVERED" }],
    limit: 36,
    chartType: "table",
    audience: ["ADMIN", "FINANCE"],
    scope: "GLOBAL"
  }),
  define({
    key: "gst_by_state",
    name: "GST by state",
    description: "Place-of-supply split. Needed once turnover crosses the registration threshold in more than one state.",
    dataset: "orders",
    dimensions: ["state"],
    measures: ["netOfGst", "gst", "revenue", "orderCount"],
    filters: [{ dimension: "status", op: "eq", value: "DELIVERED" }],
    sort: { field: "revenue", direction: "desc" },
    limit: 40,
    chartType: "table",
    audience: ["ADMIN", "FINANCE"],
    scope: "GLOBAL"
  }),
  define({
    key: "withdrawal_register",
    name: "Withdrawal and deduction register",
    description: "Payouts with the deduction withheld, by month. The basis for the TDS filing.",
    dataset: "withdrawals",
    dimensions: ["requestedAt", "status"],
    bucket: "month",
    measures: ["requested", "deduction", "net", "requestCount"],
    filters: [],
    limit: 200,
    chartType: "table",
    audience: ["ADMIN", "FINANCE"],
    scope: "GLOBAL"
  }),
  define({
    key: "sku_commission_efficiency",
    name: "Product commission efficiency",
    description: "Revenue left outside the BV pool, per SKU. A low or negative figure means the product cannot fund its own payout.",
    dataset: "order_items",
    dimensions: ["sku", "productName"],
    measures: ["units", "revenue", "bv", "marginPool"],
    filters: [],
    sort: { field: "marginPool", direction: "asc" },
    limit: 200,
    chartType: "table",
    audience: ["ADMIN", "FINANCE"],
    scope: "GLOBAL"
  }),
  define({
    key: "ledger_movement",
    name: "Ledger movement by category",
    description: "Every money flow by category and month. The audit-grade view.",
    dataset: "ledger",
    dimensions: ["postedAt", "category", "wallet"],
    bucket: "month",
    measures: ["netAmount", "amount", "entryCount"],
    filters: [],
    limit: 1e3,
    chartType: "table",
    audience: ["ADMIN", "FINANCE"],
    scope: "GLOBAL"
  })
];
var COMPLIANCE_REPORTS = [
  define({
    key: "recruitment_vs_retail",
    name: "Recruitment versus retail income",
    description: "Income paid on first orders and joining, against income from repeat sales. If the recruitment line outgrows the retail line, the plan is drifting toward the structure the Direct Selling Rules target.",
    dataset: "commission",
    dimensions: ["paidAt", "type"],
    bucket: "month",
    measures: ["amount", "legCount"],
    filters: [],
    limit: 300,
    chartType: "area",
    audience: ["ADMIN", "FINANCE"],
    scope: "GLOBAL"
  }),
  define({
    key: "income_distribution",
    name: "Income distribution",
    description: "Median, 90th percentile and average commission per earner. In most direct-selling plans the median is close to zero, and this is the honest basis for any income claim the company or its members make.",
    dataset: "commission",
    dimensions: ["paidAt"],
    bucket: "month",
    measures: ["medianPerEarner", "p90", "avgPerLeg", "earnerCount", "amount"],
    filters: [],
    limit: 36,
    chartType: "line",
    audience: ["ADMIN", "FINANCE"],
    scope: "GLOBAL"
  }),
  define({
    key: "income_by_rank",
    name: "Income concentration by rank",
    description: "How much of total payout each rank absorbs, and how many members share it.",
    dataset: "commission",
    dimensions: ["rank"],
    measures: ["amount", "earnerCount", "medianPerEarner", "p90"],
    filters: [],
    sort: { field: "amount", direction: "desc" },
    limit: 20,
    chartType: "bar",
    audience: ["ADMIN", "FINANCE"],
    scope: "GLOBAL"
  }),
  define({
    key: "repurchase_histogram",
    name: "Monthly purchase distribution",
    description: "Members bucketed by how much they bought this month. A hard spike at exactly the repurchase target means people are buying to unlock withdrawals rather than because they want the product \u2014 inventory loading, and invisible in an average.",
    dataset: "monthly_volume",
    dimensions: ["selfBvBand"],
    measures: ["memberCount", "selfBv"],
    filters: [],
    sort: { field: "selfBvBand", direction: "asc" },
    limit: 100,
    chartType: "histogram",
    audience: ["ADMIN", "FINANCE"],
    scope: "GLOBAL"
  }),
  define({
    key: "dormant_with_balance",
    name: "Dormant members holding money",
    description: "Active accounts with wallet money and no recent login. Unclaimed member funds are a liability that grows quietly.",
    dataset: "members",
    dimensions: ["memberCode", "memberName", "state", "lastLoginAt"],
    measures: ["shoppingBalance", "incomeBalance", "walletFloat"],
    filters: [{ dimension: "memberStatus", op: "eq", value: "ACTIVE" }],
    sort: { field: "walletFloat", direction: "desc" },
    limit: 500,
    chartType: "table",
    audience: ["ADMIN", "FINANCE"],
    scope: "GLOBAL"
  }),
  define({
    key: "withdrawal_rejections",
    name: "Withdrawal rejection pattern",
    description: "Rejections by month. A rising rate usually means the payout rules are unclear to members, not that members are at fault.",
    dataset: "withdrawals",
    dimensions: ["requestedAt", "status"],
    bucket: "month",
    measures: ["requestCount", "requested"],
    filters: [],
    limit: 200,
    chartType: "stackedBar",
    audience: ["ADMIN", "SUPPORT"],
    scope: "GLOBAL"
  }),
  define({
    key: "rounding_reconciliation",
    name: "Rounding dust reconciliation",
    description: "Sub-paise remainder dropped by commission rounding. Should track predictably; a jump means a plan change altered the arithmetic.",
    dataset: "commission",
    dimensions: ["paidAt"],
    bucket: "month",
    measures: ["roundingDust", "legCount", "amount"],
    filters: [],
    limit: 36,
    chartType: "table",
    audience: ["ADMIN", "FINANCE"],
    scope: "GLOBAL"
  })
];
var GROWTH_REPORTS = [
  define({
    key: "signup_cohorts",
    name: "Signups by month",
    description: "New members per month, split by rank reached.",
    dataset: "members",
    dimensions: ["joinedAt", "rank"],
    bucket: "month",
    measures: ["memberCount", "groupBv", "selfBv"],
    filters: [],
    limit: 300,
    chartType: "stackedBar",
    audience: ["ADMIN"],
    scope: "GLOBAL"
  }),
  define({
    key: "sponsor_leaderboard",
    name: "Sponsor leaderboard",
    description: "Who is actually recruiting, and whether their recruits buy anything.",
    dataset: "members",
    dimensions: ["sponsorCode"],
    measures: ["memberCount", "selfBv", "walletFloat"],
    filters: [],
    sort: { field: "memberCount", direction: "desc" },
    limit: 100,
    chartType: "table",
    audience: ["ADMIN"],
    scope: "GLOBAL"
  }),
  define({
    key: "geographic_spread",
    name: "Revenue by state and city",
    description: "Where the orders actually ship. Drives stocking and delivery partner decisions.",
    dataset: "orders",
    dimensions: ["state", "city"],
    measures: ["revenue", "orderCount", "buyerCount", "bv"],
    filters: [],
    sort: { field: "revenue", direction: "desc" },
    limit: 300,
    chartType: "heatmap",
    audience: ["ADMIN"],
    scope: "GLOBAL"
  }),
  define({
    key: "first_order_conversion",
    name: "First orders versus repeat orders",
    description: "How much of the business is new members buying once, against members who keep buying.",
    dataset: "orders",
    dimensions: ["placedAt", "isFirstPurchase"],
    bucket: "month",
    measures: ["orderCount", "revenue", "bv", "aov"],
    filters: [],
    limit: 200,
    chartType: "stackedBar",
    audience: ["ADMIN"],
    scope: "GLOBAL"
  }),
  define({
    key: "category_mix",
    name: "Category mix over time",
    description: "What members actually buy, month by month.",
    dataset: "order_items",
    dimensions: ["placedAt", "category"],
    bucket: "month",
    measures: ["revenue", "units", "bv"],
    filters: [],
    limit: 400,
    chartType: "area",
    audience: ["ADMIN"],
    scope: "GLOBAL"
  }),
  define({
    key: "depth_distribution",
    name: "Network depth distribution",
    description: "How many members sit at each level of the tree. A very deep, very thin tree is a recruitment chain, not a sales force.",
    dataset: "members",
    dimensions: ["depth"],
    measures: ["memberCount", "selfBv", "groupBv"],
    filters: [],
    sort: { field: "depth", direction: "asc" },
    limit: 100,
    chartType: "bar",
    audience: ["ADMIN"],
    scope: "GLOBAL"
  }),
  define({
    key: "top_products",
    name: "Best selling products",
    description: "Units and revenue per SKU.",
    dataset: "order_items",
    dimensions: ["sku", "productName", "category"],
    measures: ["units", "revenue", "bv"],
    filters: [],
    sort: { field: "revenue", direction: "desc" },
    limit: 100,
    chartType: "bar",
    audience: ["ADMIN"],
    scope: "GLOBAL"
  })
];
var OPERATIONS_REPORTS = [
  define({
    key: "recharge_sla",
    name: "Recharge verification SLA",
    description: "Minutes from a member submitting payment proof to an admin deciding. Manual verification is the one cost that scales linearly with member count, so this is the number to watch as the client grows.",
    dataset: "recharges",
    dimensions: ["submittedAt", "status"],
    bucket: "day",
    measures: ["requestCount", "avgReviewMinutes", "claimed", "credited"],
    filters: [],
    limit: 400,
    chartType: "line",
    audience: ["ADMIN", "SUPPORT"],
    scope: "GLOBAL"
  }),
  define({
    key: "recharge_discrepancy",
    name: "Claimed versus credited",
    description: "Where the amount a member typed differed from the bank statement. A persistent gap points at a confusing recharge screen.",
    dataset: "recharges",
    dimensions: ["submittedAt"],
    bucket: "month",
    measures: ["claimed", "credited", "discrepancy", "requestCount"],
    filters: [{ dimension: "status", op: "eq", value: "APPROVED" }],
    limit: 36,
    chartType: "table",
    audience: ["ADMIN", "FINANCE"],
    scope: "GLOBAL"
  }),
  define({
    key: "flagged_recharges",
    name: "Flagged recharges",
    description: "Requests the fraud rules flagged, and what the admin decided.",
    dataset: "recharges",
    dimensions: ["submittedAt", "status", "memberCode", "memberName"],
    bucket: "day",
    measures: ["requestCount", "claimed"],
    filters: [{ dimension: "hasFlags", op: "eq", value: "true" }],
    sort: { field: "claimed", direction: "desc" },
    limit: 500,
    chartType: "table",
    audience: ["ADMIN"],
    scope: "GLOBAL"
  }),
  define({
    key: "fulfilment_sla",
    name: "Order fulfilment SLA",
    description: "Average hours from order to delivery, by month and state.",
    dataset: "orders",
    dimensions: ["placedAt", "state"],
    bucket: "month",
    measures: ["orderCount", "fulfilHours", "revenue"],
    filters: [{ dimension: "status", op: "eq", value: "DELIVERED" }],
    limit: 400,
    chartType: "table",
    audience: ["ADMIN", "SUPPORT"],
    scope: "GLOBAL"
  }),
  define({
    key: "payout_settlement",
    name: "Payout settlement speed",
    description: "Hours from withdrawal request to money sent. Slow payouts are the fastest way to lose a productive member.",
    dataset: "withdrawals",
    dimensions: ["requestedAt"],
    bucket: "week",
    measures: ["requestCount", "avgSettleHours", "net"],
    filters: [{ dimension: "status", op: "eq", value: "PAID" }],
    limit: 120,
    chartType: "line",
    audience: ["ADMIN", "FINANCE"],
    scope: "GLOBAL"
  }),
  define({
    key: "alert_resolution",
    name: "Security alert resolution",
    description: "Alerts raised and how long they took to close, by severity.",
    dataset: "alerts",
    dimensions: ["raisedAt", "severity", "type"],
    bucket: "week",
    measures: ["alertCount", "avgResolutionHours"],
    filters: [],
    limit: 400,
    chartType: "table",
    audience: ["ADMIN"],
    scope: "GLOBAL"
  })
];
var MEMBER_REPORTS = [
  define({
    key: "my_income_breakdown",
    name: "Where my income comes from",
    description: "Your earnings split by income type, month by month.",
    dataset: "commission",
    dimensions: ["paidAt", "type"],
    bucket: "month",
    measures: ["amount", "legCount"],
    filters: [],
    limit: 120,
    chartType: "stackedBar",
    audience: ["MEMBER"],
    scope: "OWN_ROWS"
  }),
  define({
    key: "my_team_growth",
    name: "My team growth",
    description: "New members in your downline, month by month.",
    dataset: "members",
    dimensions: ["joinedAt", "rank"],
    bucket: "month",
    measures: ["memberCount", "groupBv"],
    filters: [],
    limit: 120,
    chartType: "bar",
    audience: ["MEMBER"],
    scope: "OWN_DOWNLINE"
  }),
  define({
    key: "my_team_volume",
    name: "My team volume",
    description: "What your downline is buying, month by month.",
    dataset: "orders",
    dimensions: ["placedAt"],
    bucket: "month",
    measures: ["revenue", "bv", "orderCount", "buyerCount"],
    filters: [],
    limit: 120,
    chartType: "line",
    audience: ["MEMBER"],
    scope: "OWN_DOWNLINE"
  }),
  define({
    key: "my_purchases",
    name: "My purchase history",
    description: "What you have bought, by category.",
    dataset: "order_items",
    dimensions: ["placedAt", "category"],
    bucket: "month",
    measures: ["revenue", "units", "bv"],
    filters: [],
    limit: 120,
    chartType: "area",
    audience: ["MEMBER"],
    scope: "OWN_ROWS"
  }),
  define({
    key: "my_wallet_statement",
    name: "My wallet statement",
    description: "Every movement in and out of your wallets.",
    dataset: "ledger",
    dimensions: ["postedAt", "category", "wallet", "direction"],
    bucket: "day",
    measures: ["netAmount", "entryCount"],
    filters: [],
    limit: 500,
    chartType: "table",
    audience: ["MEMBER"],
    scope: "OWN_ROWS"
  })
];
var ALL_PRESETS = [
  ...FINANCE_REPORTS,
  ...COMPLIANCE_REPORTS,
  ...GROWTH_REPORTS,
  ...OPERATIONS_REPORTS,
  ...MEMBER_REPORTS
];
function validatePresets() {
  return ALL_PRESETS.map((preset) => {
    const result = ReportDefinitionSchema.safeParse(preset);
    if (!result.success) {
      throw new Error(`Preset "${preset.key}" is invalid: ${JSON.stringify(result.error.issues)}`);
    }
    return result.data;
  });
}
var PRESET_GROUPS = [
  { key: "finance", label: "Finance", reports: FINANCE_REPORTS },
  { key: "compliance", label: "Compliance", reports: COMPLIANCE_REPORTS },
  { key: "growth", label: "Growth", reports: GROWTH_REPORTS },
  { key: "operations", label: "Operations", reports: OPERATIONS_REPORTS },
  { key: "member", label: "Member facing", reports: MEMBER_REPORTS }
];

// src/__tests__/reporting.spec.ts
var ADMIN = { type: "ADMIN", id: "admin1", role: "ADMIN" };
var MEMBER = {
  type: "MEMBER",
  id: "mem1",
  memberId: "ckmem1",
  ancestorPath: "/company/priya/"
};
var def = (over = {}) => parseDefinition({
  key: "test_report",
  name: "Test report",
  dataset: "orders",
  dimensions: ["placedAt"],
  bucket: "month",
  measures: ["revenue", "orderCount"],
  filters: [],
  limit: 100,
  chartType: "line",
  audience: ["ADMIN"],
  scope: "GLOBAL",
  ...over
});
test("a simple report compiles to grouped, parameterised SQL", () => {
  const q = compile(def(), ADMIN);
  assert.match(q.sql, /^SELECT /);
  assert.match(q.sql, /date_trunc\('month'/);
  assert.match(q.sql, /FROM "Order" o JOIN "Member" m/);
  assert.match(q.sql, /GROUP BY/);
  assert.match(q.sql, /LIMIT 100/);
  assert.deepEqual(q.columns.map((c) => c.key), ["placedAt", "revenue", "orderCount"]);
  assert.equal(q.columns[1].type, "money");
});
test("the dataset base filter is always applied", () => {
  assert.match(compile(def(), ADMIN).sql, /o\.status <> 'CANCELLED'/);
});
test("the row limit is clamped to the hard ceiling", () => {
  assert.throws(() => def({ limit: 999999 }), /less than or equal to 5000|too_big/);
  assert.match(compile(def({ limit: MAX_ROWS }), ADMIN).sql, new RegExp(`LIMIT ${MAX_ROWS}`));
});
test("a filter value never reaches the SQL text \u2014 it is always a bound parameter", () => {
  const nasty = `'; DROP TABLE "Member"; --`;
  const q = compile(def({ filters: [{ dimension: "city", op: "eq", value: nasty }] }), ADMIN);
  assert.equal(q.sql.includes("DROP TABLE"), false);
  assert.equal(q.sql.includes(nasty), false);
  assert.match(q.sql, /o\."shipCity" = \$1/);
  assert.deepEqual(q.params, [nasty]);
});
test("a contains filter builds its wildcards around the parameter, not inside the SQL", () => {
  const q = compile(def({ filters: [{ dimension: "city", op: "contains", value: "%' OR 1=1 --" }] }), ADMIN);
  assert.equal(q.sql.includes("OR 1=1"), false);
  assert.match(q.sql, /ILIKE \$1/);
  assert.equal(q.params[0], "%%' OR 1=1 --%");
});
test("an unknown dimension, measure or dataset is rejected at parse time", () => {
  assert.throws(() => def({ dimensions: ['(SELECT passwordHash FROM "Member")'] }), /is not a dimension/);
  assert.throws(() => def({ measures: ['revenue, m."passwordHash"'] }), /is not a measure/);
  assert.throws(() => def({ dataset: "pg_catalog.pg_user" }), /Unknown dataset/);
});
test("an unknown filter operator is rejected", () => {
  assert.throws(
    () => def({ filters: [{ dimension: "city", op: "RAW_SQL", value: "1=1" }] }),
    /invalid|Invalid|enum/
  );
});
test("a bucket value outside the whitelist is rejected", () => {
  assert.throws(() => def({ bucket: "month'); DROP TABLE x; --" }), /invalid|Invalid|enum/);
});
test("a report key cannot carry anything but lowercase, digits and underscores", () => {
  assert.throws(() => def({ key: 'bad key"; --' }), /lowercase letters/);
});
test("every parameter placeholder in the SQL has a matching bound value", () => {
  const q = compile(
    def({
      filters: [
        { dimension: "city", op: "in", value: ["Kolkata", "Siliguri", "Patna"] },
        { dimension: "placedAt", op: "between", value: ["2026-01-01", "2026-09-30"] },
        { dimension: "state", op: "neq", value: "Goa" }
      ]
    }),
    ADMIN
  );
  const placeholders = [...q.sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
  assert.equal(new Set(placeholders).size, q.params.length);
  assert.equal(Math.max(...placeholders), q.params.length);
  assert.equal(q.params.length, 6);
});
test("a member caller is confined to their downline even when the definition says GLOBAL", () => {
  const sneaky = def({ audience: ["ADMIN", "MEMBER"], scope: "GLOBAL" });
  const q = compile(sneaky, MEMBER);
  assert.equal(q.scopeApplied, "OWN_DOWNLINE");
  assert.match(q.sql, /"ancestorPath" LIKE \$\d+/);
  assert.ok(q.params.includes("/company/priya/ckmem1/%"));
});
test("the downline prefix ends in a slash so one member cannot match another", () => {
  const q = compile(def({ audience: ["MEMBER"], scope: "OWN_DOWNLINE" }), MEMBER);
  const prefix = q.params.find((p) => typeof p === "string" && p.endsWith("/%"));
  assert.equal(prefix, "/company/priya/ckmem1/%");
  assert.equal(prefix.includes("ckmem1/"), true);
});
test("OWN_ROWS narrows to the member themselves, not their team", () => {
  const q = compile(def({ audience: ["MEMBER"], scope: "OWN_ROWS" }), MEMBER);
  assert.equal(q.scopeApplied, "OWN_ROWS");
  assert.match(q.sql, /m\.id = \$\d+/);
  assert.equal(q.sql.includes("ancestorPath"), false);
});
test("a member cannot open a report that is not published to members", () => {
  assert.throws(() => compile(def({ audience: ["ADMIN"] }), MEMBER), /not available to members/);
});
test("a dataset with no member scoping can never be published to members", () => {
  assert.equal(getDataset("alerts").scoping, void 0);
  assert.throws(
    () => def({ dataset: "alerts", dimensions: ["severity"], measures: ["alertCount"], bucket: void 0, audience: ["MEMBER"] }),
    /cannot be shown to members/
  );
});
test("a member caller with no genealogy context is refused rather than run unscoped", () => {
  const broken = { type: "MEMBER", id: "x", memberId: "ckmem1" };
  assert.throws(() => compile(def({ audience: ["MEMBER"] }), broken), /refusing to run an unscoped query/);
});
test("an admin report stays company-wide", () => {
  const q = compile(def(), ADMIN);
  assert.equal(q.scopeApplied, "GLOBAL");
  assert.equal(q.sql.includes("ancestorPath"), false);
});
test("filter operators render the expected SQL", () => {
  const cases = [
    ["eq", "Kolkata", /= \$1/],
    ["neq", "Kolkata", /<> \$1/],
    ["gt", "A", /> \$1/],
    ["gte", "A", />= \$1/],
    ["lt", "Z", /< \$1/],
    ["lte", "Z", /<= \$1/],
    ["in", ["A", "B"], /IN \(\$1, \$2\)/],
    ["notIn", ["A", "B"], /NOT IN \(\$1, \$2\)/],
    ["between", ["A", "B"], /BETWEEN \$1 AND \$2/],
    ["isNull", void 0, /IS NULL/],
    ["notNull", void 0, /IS NOT NULL/]
  ];
  for (const [op, value, pattern] of cases) {
    const q = compile(def({ filters: [{ dimension: "city", op, value }] }), ADMIN);
    assert.match(q.sql, pattern, `operator ${op}`);
  }
});
test("operators that need a value are rejected without one", () => {
  assert.throws(() => def({ filters: [{ dimension: "city", op: "eq" }] }), /needs a value/);
  assert.throws(() => def({ filters: [{ dimension: "city", op: "in", value: [] }] }), /non-empty list/);
  assert.throws(() => def({ filters: [{ dimension: "placedAt", op: "between", value: ["only-one"] }] }), /exactly two/);
});
test("a boolean-valued enum dimension is coerced to a real boolean", () => {
  const q = compile(def({ filters: [{ dimension: "isFirstPurchase", op: "eq", value: "true" }] }), ADMIN);
  assert.equal(q.params[0], true);
  assert.notEqual(q.params[0], "true");
});
test("a date filter is bound as a Date, and an unparseable one is refused", () => {
  const q = compile(def({ filters: [{ dimension: "placedAt", op: "gte", value: "2026-04-01" }] }), ADMIN);
  assert.ok(q.params[0] instanceof Date);
  assert.throws(() => compile(def({ filters: [{ dimension: "placedAt", op: "gte", value: "last tuesday" }] }), ADMIN), /not a valid date/);
});
test("sorting is restricted to catalog fields", () => {
  const q = compile(def({ sort: { field: "revenue", direction: "desc" } }), ADMIN);
  assert.match(q.sql, /ORDER BY "revenue" DESC/);
  assert.throws(() => def({ sort: { field: "(SELECT 1)", direction: "asc" } }), /neither a dimension nor/);
});
test("a bucket without a date dimension is refused", () => {
  assert.throws(() => def({ dimensions: ["state"], bucket: "month" }), /needs a date dimension/);
});
test("every shipped preset is valid against the catalog", () => {
  assert.doesNotThrow(() => validatePresets());
  assert.ok(ALL_PRESETS.length >= 30, `expected 30+ presets, found ${ALL_PRESETS.length}`);
});
test("every preset compiles for an admin", () => {
  const onBehalfOf = { memberId: "ckmem1", ancestorPath: "/company/priya/" };
  for (const preset of ALL_PRESETS) {
    const memberOnly = preset.audience.every((a) => a === "MEMBER");
    const caller = memberOnly ? { ...ADMIN, onBehalfOf } : ADMIN;
    assert.doesNotThrow(() => compile(preset, caller), `preset ${preset.key} failed to compile`);
  }
});
test("an admin must name a member before opening a member report", () => {
  const memberReport = def({ audience: ["MEMBER"], scope: "OWN_ROWS" });
  assert.throws(() => compile(memberReport, ADMIN), /Choose which member/);
  const q = compile(memberReport, { ...ADMIN, onBehalfOf: { memberId: "ckmem9", ancestorPath: "/company/" } });
  assert.equal(q.scopeApplied, "OWN_ROWS");
  assert.ok(q.params.includes("ckmem9"));
});
test("impersonation cannot widen a member report past that member", () => {
  const teamReport = def({ audience: ["MEMBER"], scope: "GLOBAL" });
  const q = compile(teamReport, { ...ADMIN, onBehalfOf: { memberId: "ckmem9", ancestorPath: "/company/" } });
  assert.equal(q.scopeApplied, "OWN_DOWNLINE");
  assert.ok(q.params.includes("/company/ckmem9/%"));
});
test("a staff report still respects role restrictions", () => {
  const financeOnly = def({ audience: ["FINANCE"] });
  assert.throws(() => compile(financeOnly, { type: "ADMIN", id: "a", role: "SUPPORT" }), /role does not have access/);
  assert.doesNotThrow(() => compile(financeOnly, { type: "ADMIN", id: "a", role: "FINANCE" }));
});
test("every member-facing preset compiles scoped, and no admin preset is member-visible", () => {
  for (const preset of ALL_PRESETS) {
    if (preset.audience.includes("MEMBER")) {
      const q = compile(preset, MEMBER);
      assert.notEqual(q.scopeApplied, "GLOBAL", `${preset.key} ran unscoped for a member`);
      assert.ok(q.params.length > 0, `${preset.key} bound no scope parameter`);
    } else {
      assert.throws(() => compile(preset, MEMBER), `${preset.key} should be closed to members`);
    }
  }
});
test("preset keys are unique", () => {
  const keys = ALL_PRESETS.map((p) => p.key);
  assert.equal(new Set(keys).size, keys.length);
});
test("presets cover every reporting area", () => {
  assert.deepEqual(PRESET_GROUPS.map((g) => g.key), ["finance", "compliance", "growth", "operations", "member"]);
  for (const group of PRESET_GROUPS) assert.ok(group.reports.length >= 4, `${group.key} is thin`);
});
test("the catalog exposed to the UI carries no SQL", () => {
  const described = JSON.stringify(describeCatalog());
  for (const needle of ["SELECT", "FROM", "JOIN", "passwordHash", '"Member"', "SUM("]) {
    assert.equal(described.includes(needle), false, `catalog leaked "${needle}" to the client`);
  }
});
test("no dataset exposes a credential or secret column", () => {
  const forbidden = ["passwordHash", "totpSecret", "codeHash", "tokenHash", "payoutAccount", "salt"];
  for (const ds of Object.values(CATALOG)) {
    const sql = [ds.from, ds.baseWhere ?? "", ...Object.values(ds.dimensions).map((d) => d.sql), ...Object.values(ds.measures).map((m) => m.sql)].join(" ");
    for (const secret of forbidden) {
      assert.equal(sql.includes(secret), false, `${ds.key} exposes ${secret}`);
    }
  }
});
test("every dataset that claims member scoping actually binds both parameters", () => {
  for (const ds of Object.values(CATALOG)) {
    if (!ds.scoping) continue;
    assert.match(ds.scoping.ownRows, /\$memberId/, `${ds.key} ownRows has no member binding`);
    assert.match(ds.scoping.downline, /\$pathPrefix/, `${ds.key} downline has no prefix binding`);
  }
});
