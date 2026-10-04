import assert from 'node:assert/strict';
import { test, before } from 'node:test';
import { randomBytes } from 'node:crypto';
import { initEncryption } from '../common/crypto';
import { PushService, destinationFor } from '../notifications/push.service';

before(() => {
  initEncryption({ FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'), FIELD_ENCRYPTION_KEY_VERSION: '1' } as NodeJS.ProcessEnv);
});

test('tapping a notification opens the page it is about', () => {
  assert.equal(destinationFor('ORDER'), '/orders');
  assert.equal(destinationFor('WALLET'), '/wallet');
  assert.equal(destinationFor('STOCK'), '/wishlist');
  assert.equal(destinationFor('CART'), '/cart');
  assert.equal(destinationFor('SOMETHING_NEW'), '/account');
});

function fakePrisma() {
  let row: { value: unknown } | null = null;
  const subs = new Map<string, any>();
  return {
    storeSetting: {
      findUnique: async () => row,
      createMany: async ({ data }: any) => { if (!row) row = { value: data[0].value }; },
    },
    pushSubscription: {
      upsert: async ({ where, create, update }: any) => { subs.set(where.endpoint, { ...(subs.get(where.endpoint) ?? create), ...(subs.has(where.endpoint) ? update : {}) }); },
      deleteMany: async ({ where }: any) => { for (const [k, v] of subs) if ((where.endpoint === undefined || k === where.endpoint) && (where.memberId === undefined || v.memberId === where.memberId)) subs.delete(k); },
      count: async ({ where }: any) => [...subs.values()].filter((v) => v.memberId === where.memberId).length,
      findMany: async ({ where }: any) => [...subs.entries()].filter(([, v]) => v.memberId === where.memberId).map(([endpoint, v], i) => ({ id: `s${i}`, endpoint, ...v })),
    },
  };
}

test('the signing keys are made once, saved encrypted, and the same ones come back after a restart', async () => {
  const prisma = fakePrisma();
  const a = new PushService(prisma as never);
  const key = await a.publicKey();
  assert.ok(key.length > 60);
  const stored = JSON.stringify((await prisma.storeSetting.findUnique())!.value);
  assert.equal(stored.includes('privateKey"'), false, 'the private key is stored as plain text');

  const b = new PushService(prisma as never); // a fresh process
  assert.equal(await b.publicKey(), key);
});

test('a device is saved once per address, moves with the account that last used it, and can be removed', async () => {
  const prisma = fakePrisma();
  const svc = new PushService(prisma as never);
  const sub = { endpoint: 'https://push.example/abc', keys: { p256dh: 'p'.repeat(20), auth: 'a'.repeat(16) } };
  await svc.subscribe('m1', sub);
  await svc.subscribe('m1', sub);
  assert.equal(await svc.count('m1'), 1);

  await svc.subscribe('m2', sub); // someone else signs in on the same phone
  assert.equal(await svc.count('m1'), 0);
  assert.equal(await svc.count('m2'), 1);

  await svc.unsubscribe('m1', sub.endpoint); // not theirs any more: nothing removed
  assert.equal(await svc.count('m2'), 1);
  await svc.unsubscribe('m2', sub.endpoint);
  assert.equal(await svc.count('m2'), 0);
});

test('a member with no device allowed gets nothing sent', async () => {
  const svc = new PushService(fakePrisma() as never);
  assert.equal(await svc.sendToMember('nobody', { title: 't', body: 'b', url: '/' }), 0);
});
