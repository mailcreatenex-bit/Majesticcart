import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WishlistService } from '../catalog/wishlist.service';

/**
 * WishlistService against a small in-memory stand-in for Prisma: just enough
 * of the calls the service makes to check its rules (save, unsave, alerting
 * only while out of stock, the restock sweep telling each member once).
 */

interface Product { id: string; slug: string; name: string; stock: number; isActive: boolean }
interface Item { id: string; memberId: string; productId: string; alertWhenBack: boolean }

function fake(products: Product[]) {
  const items: Item[] = [];
  const notifications: { memberId: string; kind: string; title: string; body: string }[] = [];
  let n = 0;
  const byProduct = (id: string) => products.find((p) => p.id === id)!;
  const prisma = {
    product: {
      findFirst: async ({ where }: any) => products.find((p) => p.slug === where.slug && p.isActive === where.isActive) ?? null,
    },
    wishlistItem: {
      count: async ({ where }: any) => items.filter((i) => i.memberId === where.memberId).length,
      findUnique: async ({ where }: any) => items.find((i) => i.memberId === where.memberId_productId.memberId && i.productId === where.memberId_productId.productId) ?? null,
      upsert: async ({ where, create, update }: any) => {
        const k = where.memberId_productId;
        const hit = items.find((i) => i.memberId === k.memberId && i.productId === k.productId);
        if (hit) Object.assign(hit, update);
        else items.push({ id: `w${++n}`, ...create });
      },
      findMany: async ({ where }: any) => {
        let rows = items.filter((i) => (where.memberId ? i.memberId === where.memberId : true));
        if (where.alertWhenBack !== undefined) rows = rows.filter((i) => i.alertWhenBack === where.alertWhenBack);
        if (where.product?.stock?.gt !== undefined) rows = rows.filter((i) => byProduct(i.productId).stock > where.product.stock.gt && byProduct(i.productId).isActive);
        if (where.product?.isActive) rows = rows.filter((i) => byProduct(i.productId).isActive);
        return rows.map((i) => ({ ...i, product: byProduct(i.productId) }));
      },
      deleteMany: async ({ where }: any) => {
        const before = items.length;
        for (let i = items.length - 1; i >= 0; i--) {
          if (items[i].memberId === where.memberId && byProduct(items[i].productId).slug === where.product.slug) items.splice(i, 1);
        }
        return { count: before - items.length };
      },
      updateMany: async ({ where, data }: any) => {
        const hit = items.filter((i) => i.id === where.id && i.alertWhenBack === where.alertWhenBack);
        hit.forEach((i) => Object.assign(i, data));
        return { count: hit.length };
      },
    },
    notification: { create: async ({ data }: any) => { notifications.push(data); } },
  };
  return { svc: new WishlistService(prisma as never), items, notifications };
}

const stocked: Product = { id: 'p1', slug: 'serum', name: 'Vitamin C Serum', stock: 5, isActive: true };
const soldOut: Product = { id: 'p2', slug: 'lipstick', name: 'Velvet Lipstick', stock: 0, isActive: true };
const hidden: Product = { id: 'p3', slug: 'old', name: 'Old', stock: 3, isActive: false };

test('saving an in-stock product keeps it without an alert', async () => {
  const { svc, items } = fake([stocked]);
  assert.deepEqual(await svc.add('m1', 'serum'), { saved: true, alert: false });
  assert.equal(items.length, 1);
  assert.equal(items[0].alertWhenBack, false);
});

test('saving an out-of-stock product asks to be told when it is back', async () => {
  const { svc } = fake([soldOut]);
  assert.deepEqual(await svc.add('m1', 'lipstick'), { saved: true, alert: true });
  assert.deepEqual((await svc.slugs('m1')).alerts, ['lipstick']);
});

test('saving twice is one item, and unsaving removes it', async () => {
  const { svc, items } = fake([stocked]);
  await svc.add('m1', 'serum');
  await svc.add('m1', 'serum');
  assert.equal(items.length, 1);
  assert.deepEqual(await svc.remove('m1', 'serum'), { saved: false });
  assert.equal(items.length, 0);
  assert.deepEqual(await svc.remove('m1', 'serum'), { saved: false }, 'removing what is not there is fine');
});

test('one member cannot see or remove another member\'s list', async () => {
  const { svc } = fake([stocked]);
  await svc.add('m1', 'serum');
  assert.deepEqual((await svc.slugs('m2')).slugs, []);
  await svc.remove('m2', 'serum');
  assert.deepEqual((await svc.slugs('m1')).slugs, ['serum']);
});

test('an unknown or hidden product cannot be saved', async () => {
  const { svc } = fake([hidden]);
  await assert.rejects(svc.add('m1', 'nope'), /not found/i);
  await assert.rejects(svc.add('m1', 'old'), /not found/i);
});

test('the restock sweep tells each waiting member once, and only when stock is back', async () => {
  const lipstick = { ...soldOut };
  const { svc, notifications } = fake([lipstick]);
  await svc.add('m1', 'lipstick');
  await svc.add('m2', 'lipstick');

  assert.equal(await svc.sweep(), 0, 'still out of stock: nobody is told');
  lipstick.stock = 12;
  assert.equal(await svc.sweep(), 2);
  assert.deepEqual(notifications.map((n) => n.memberId).sort(), ['m1', 'm2']);
  assert.ok(notifications.every((n) => n.kind === 'STOCK' && n.body.includes('Velvet Lipstick')));
  assert.equal(await svc.sweep(), 0, 'told once, not again');
});

test('a plain save of something in stock is never announced', async () => {
  const { svc, notifications } = fake([stocked]);
  await svc.add('m1', 'serum');
  assert.equal(await svc.sweep(), 0);
  assert.equal(notifications.length, 0);
});

test('the list is capped', async () => {
  const many = Array.from({ length: 201 }, (_, i): Product => ({ id: `x${i}`, slug: `p${i}`, name: `P${i}`, stock: 1, isActive: true }));
  const { svc } = fake(many);
  for (let i = 0; i < 200; i++) await svc.add('m1', `p${i}`);
  await assert.rejects(svc.add('m1', 'p200'), /full/i);
  await svc.add('m1', 'p0'); // an item already on the list can still be re-saved
});
