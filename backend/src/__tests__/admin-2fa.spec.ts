import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { AuthGuard, AdminOnly, AllowWithout2fa, RequirePermission, MemberOnly } from '../auth/guards';
import type { AccessClaims } from '../auth/token.service';

class Routes {
  @RequirePermission('orders.manage') orders() {}
  @AdminOnly() @AllowWithout2fa() me() {}
  @MemberOnly() mine() {}
}

const guardFor = (claims: AccessClaims) =>
  new AuthGuard({ verifyAsync: async () => claims } as never, new Reflector());

const ctx = (handler: () => void): ExecutionContext =>
  ({
    getHandler: () => handler,
    getClass: () => Routes,
    switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: 'Bearer x' } }) }),
  }) as unknown as ExecutionContext;

const admin = (over: Partial<AccessClaims> = {}): AccessClaims => ({ sub: 'a1', typ: 'ADMIN', permissions: ['orders.manage'], ...over });
const proto = Routes.prototype;

afterEach(() => { delete process.env.ADMIN_REQUIRE_2FA; });

test('an admin without two-factor is refused on a normal console route, with a code the console can act on', async () => {
  await assert.rejects(
    guardFor(admin()).canActivate(ctx(proto.orders)),
    (e: { getResponse: () => { code?: string } }) => e.getResponse().code === 'TWO_FACTOR_REQUIRED',
  );
});

test('an admin with two-factor gets through', async () => {
  assert.equal(await guardFor(admin({ mfa: true })).canActivate(ctx(proto.orders)), true);
});

test('an admin without two-factor can still ask who they are and enrol', async () => {
  assert.equal(await guardFor(admin()).canActivate(ctx(proto.me)), true);
});

test('ADMIN_REQUIRE_2FA=false is the lock-out escape hatch', async () => {
  process.env.ADMIN_REQUIRE_2FA = 'false';
  assert.equal(await guardFor(admin()).canActivate(ctx(proto.orders)), true);
});

test('members are not affected by the admin rule', async () => {
  assert.equal(await guardFor({ sub: 'm1', typ: 'MEMBER' }).canActivate(ctx(proto.mine)), true);
});

test('having the permission is not enough without two-factor', async () => {
  await assert.rejects(guardFor(admin({ mfa: false, permissions: ['orders.manage', 'roles.manage'] })).canActivate(ctx(proto.orders)));
});
