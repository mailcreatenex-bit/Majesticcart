import assert from 'node:assert/strict';
import { test, before, beforeEach } from 'node:test';
import { randomBytes } from 'node:crypto';
import { initEncryption } from '../common/crypto';
import { IntegrationsService } from '../integrations/integrations.service';

before(() => {
  initEncryption({ FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'), FIELD_ENCRYPTION_KEY_VERSION: '1' } as NodeJS.ProcessEnv);
});

function fake() {
  let row: unknown = null;
  const audits: { action: string; detail: any }[] = [];
  const prisma = {
    storeSetting: {
      findUnique: async () => (row ? { value: row } : null),
      upsert: async ({ create }: any) => { row = create.value; },
    },
    auditLog: { create: async ({ data }: any) => { audits.push(data); } },
  };
  return { svc: new IntegrationsService(prisma as never), raw: () => row, audits };
}

const ENV_KEYS = ['SMS_ENDPOINT', 'SMS_API_KEY', 'SMS_PROVIDER', 'DELHIVERY_API_TOKEN', 'WHATSAPP_ENDPOINT', 'WHATSAPP_TOKEN', 'RESEND_API_KEY', 'EMAIL_PROVIDER'];
beforeEach(() => { for (const k of ENV_KEYS) delete process.env[k]; });

test('a secret is saved encrypted, and the console only ever gets its last four characters', async () => {
  const { svc, raw } = fake();
  await svc.update('courier', { delhiveryToken: 'tok_live_ABCDEF123456' }, 'a1');

  assert.equal(JSON.stringify(raw()).includes('ABCDEF123456'), false, 'the token is visible in what is stored');
  const status = await svc.status();
  assert.deepEqual(status.courier.delhiveryToken, { set: true, last4: '3456' });
  assert.equal(JSON.stringify(status).includes('tok_live'), false);
  assert.equal((await svc.resolve()).courier.delhiveryToken, 'tok_live_ABCDEF123456');
});

test('leaving a secret out keeps it, null clears it, a plain field set to blank is cleared', async () => {
  const { svc } = fake();
  await svc.update('sms', { endpoint: 'https://sms.example/send', apiKey: 'key-123456789', senderId: 'MJSTIC' }, 'a1');
  await svc.update('sms', { senderId: 'OTHER' }, 'a1');
  let cfg = await svc.resolve();
  assert.equal(cfg.sms.apiKey, 'key-123456789');
  assert.equal(cfg.sms.senderId, 'OTHER');

  await svc.update('sms', { senderId: '' }, 'a1');
  cfg = await svc.resolve();
  assert.equal(cfg.sms.senderId, '');
  assert.equal(cfg.sms.apiKey, 'key-123456789');

  await svc.update('sms', { apiKey: null }, 'a1');
  cfg = await svc.resolve();
  assert.equal(cfg.sms.apiKey, '');
  assert.equal(cfg.sms.enabled, false, 'no key, so SMS is off');
});

test('SMS counts as on only with both an address and a key', async () => {
  const { svc } = fake();
  await svc.update('sms', { endpoint: 'https://sms.example/send' }, 'a1');
  assert.equal((await svc.resolve()).sms.enabled, false);
  await svc.update('sms', { apiKey: 'key-123456789' }, 'a1');
  assert.equal((await svc.resolve()).sms.enabled, true);
});

test('what an admin enters wins over the server environment, and the environment still works when nothing is entered', async () => {
  process.env.DELHIVERY_API_TOKEN = 'from-env-token';
  const { svc } = fake();
  assert.equal((await svc.resolve()).courier.delhiveryToken, 'from-env-token');

  await svc.update('courier', { delhiveryToken: 'from-console-token' }, 'a1');
  assert.equal((await svc.resolve()).courier.delhiveryToken, 'from-console-token');
});

test('the old server settings keep SMS working until the console is used', async () => {
  process.env.SMS_PROVIDER = 'http';
  process.env.SMS_ENDPOINT = 'https://sms.example/send';
  process.env.SMS_API_KEY = 'env-key-12345';
  const { svc } = fake();
  assert.equal((await svc.resolve()).sms.enabled, true);
});

test('bad input is refused with a plain message and nothing is saved', async () => {
  const { svc, raw } = fake();
  await assert.rejects(svc.update('sms', { endpoint: 'http://not-secure.example' }, 'a1'), /https/);
  await assert.rejects(svc.update('alerts', { email: 'nope' }, 'a1'), /email/i);
  await assert.rejects(svc.update('sms', { apiKey: 'has a space' }, 'a1'), /spaces/);
  await assert.rejects(svc.update('sms', { nonsense: 'x' }, 'a1'), /Unknown field/);
  assert.equal(raw(), null);
});

test('the audit log records which fields changed, never their values', async () => {
  const { svc, audits } = fake();
  await svc.update('whatsapp', { endpoint: 'https://wa.example/send', token: 'secret-token-9999' }, 'a1');
  assert.equal(audits.length, 1);
  assert.deepEqual(audits[0].detail, { section: 'whatsapp', fields: ['endpoint', 'token'] });
  assert.equal(JSON.stringify(audits).includes('secret-token'), false);
});
