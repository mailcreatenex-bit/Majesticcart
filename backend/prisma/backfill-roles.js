const { PrismaClient } = require('@prisma/client');

const ALL_PERMISSIONS = [
  'dashboard.view', 'reports.view', 'reports.manage', 'security.view',
  'orders.manage', 'orders.return',
  'catalog.manage', 'coupons.manage',
  'finance.recharges', 'finance.withdrawals', 'finance.mobile_recharges', 'finance.ledger_drift', 'plan.manage',
  'blog.manage', 'pages.manage', 'theme.manage',
  'settings.manage', 'roles.manage',
];
const FINANCE_PERMISSIONS = [
  'dashboard.view', 'reports.view', 'reports.manage', 'security.view',
  'coupons.manage',
  'finance.recharges', 'finance.withdrawals', 'finance.mobile_recharges', 'finance.ledger_drift',
];
const SUPPORT_PERMISSIONS = ['dashboard.view', 'reports.view', 'security.view', 'orders.manage'];

const prisma = new PrismaClient();

async function main() {
  const admin = await prisma.role.upsert({
    where: { name: 'ADMIN' },
    create: { name: 'ADMIN', description: 'Full access to everything.', permissions: ALL_PERMISSIONS, isSystem: true },
    update: { permissions: ALL_PERMISSIONS, isSystem: true },
  });
  await prisma.role.upsert({
    where: { name: 'FINANCE' },
    create: { name: 'FINANCE', description: 'Recharges, withdrawals, coupons, reports.', permissions: FINANCE_PERMISSIONS, isSystem: true },
    update: { permissions: FINANCE_PERMISSIONS, isSystem: true },
  });
  await prisma.role.upsert({
    where: { name: 'SUPPORT' },
    create: { name: 'SUPPORT', description: 'Orders, dashboard, security alerts.', permissions: SUPPORT_PERMISSIONS, isSystem: true },
    update: { permissions: SUPPORT_PERMISSIONS, isSystem: true },
  });

  const orphans = await prisma.adminUser.findMany({ where: { roleId: null } });
  for (const a of orphans) {
    await prisma.adminUser.update({ where: { id: a.id }, data: { roleId: admin.id } });
    console.log(`Backfilled ${a.email} -> ADMIN role`);
  }
  console.log('Done.');
}

main().finally(() => prisma.$disconnect());
