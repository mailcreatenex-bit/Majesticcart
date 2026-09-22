/**
 * The full set of things an admin route can require.
 *
 * A permission key is checked with `RequirePermission(key)` on a route (see
 * `guards.ts`) and granted to a `Role` row as a plain string in its
 * `permissions` array — there is no separate permissions table, because this
 * list *is* the schema: adding a capability to the app means adding a key
 * here and gating a route with it, not a migration.
 *
 * Grouped by area so the role editor can render them as sections rather than
 * one long checkbox list.
 */
export interface PermissionDef {
  key: string;
  label: string;
  group: string;
}

export const PERMISSIONS: PermissionDef[] = [
  { key: 'dashboard.view', label: 'View the dashboard', group: 'General' },
  { key: 'reports.view', label: 'Run reports', group: 'General' },
  { key: 'reports.manage', label: 'Build and save custom reports', group: 'General' },
  { key: 'security.view', label: 'View security alerts', group: 'General' },

  { key: 'orders.manage', label: 'Manage orders (fulfilment)', group: 'Orders' },
  { key: 'orders.return', label: 'Process returns', group: 'Orders' },

  { key: 'catalog.manage', label: 'Manage products, brands, categories', group: 'Catalogue' },
  { key: 'coupons.manage', label: 'Manage coupons', group: 'Catalogue' },

  { key: 'finance.recharges', label: 'Approve wallet recharges', group: 'Finance' },
  { key: 'finance.withdrawals', label: 'Approve withdrawals', group: 'Finance' },
  { key: 'finance.mobile_recharges', label: 'Manage mobile recharges', group: 'Finance' },
  { key: 'finance.ledger_drift', label: 'View ledger integrity checks', group: 'Finance' },
  { key: 'plan.manage', label: 'Edit the compensation plan', group: 'Finance' },

  { key: 'blog.manage', label: 'Write and publish blog posts', group: 'Content' },
  { key: 'pages.manage', label: 'Add and edit custom pages', group: 'Content' },
  { key: 'theme.manage', label: 'Edit site theme and homepage content', group: 'Content' },

  { key: 'settings.manage', label: 'Manage store settings', group: 'Admin' },
  { key: 'roles.manage', label: 'Manage roles and admin accounts', group: 'Admin' },
];

export const ALL_PERMISSIONS: string[] = PERMISSIONS.map((p) => p.key);

export const FINANCE_PERMISSIONS: string[] = [
  'dashboard.view', 'reports.view', 'reports.manage', 'security.view',
  'coupons.manage',
  'finance.recharges', 'finance.withdrawals', 'finance.mobile_recharges', 'finance.ledger_drift',
];

export const SUPPORT_PERMISSIONS: string[] = [
  'dashboard.view', 'reports.view', 'security.view',
  'orders.manage',
];

const VALID = new Set(ALL_PERMISSIONS);

/** Filters out anything that isn't a real permission key — a role's stored list should never grant something the app can't check. */
export function sanitisePermissions(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.filter((p): p is string => typeof p === 'string' && VALID.has(p)))];
}
