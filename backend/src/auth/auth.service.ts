import { Inject, Injectable, Logger, BadRequestException, UnauthorizedException, ConflictException } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { TokenService, IssuedSession, SessionContext } from './token.service';
import { SMS_SENDER } from '../notifications/sms.service';
import {
  hashPassword, verifyPassword, passwordNeedsRehash, checkPasswordPolicy,
  generateOtpCode, hashOtpCode, otpMatches, nextLockout, isLockedOut, lockoutMessage,
} from './credentials';
import { verifyTotp, generateTotpSecret, totpProvisioningUri, totpQrSvg } from './totp';
import { decryptIfNeeded, encryptField, ctx as encCtx } from '../common/crypto';
import { childPath, formatMemberCode } from '../member/genealogy';

/**
 * Authentication.
 *
 * Members sign in with phone plus password, or phone plus OTP. Admins use email
 * plus password plus TOTP.
 *
 * One rule runs through all of it: failures are indistinguishable from the
 * outside. "No account matches that number" tells an attacker which numbers are
 * registered, which is exactly the enumeration a competitor would run against a
 * direct-selling roster. Every failed login returns the same message.
 */

const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_SECONDS = 60;
const OTP_MAX_PER_HOUR = 5;
const GENERIC_LOGIN_FAILURE = 'That phone number or password is not right.';

export interface SignupInput {
  name: string;
  phone: string;
  email?: string;
  password: string;
  sponsorCode?: string;
  deviceId?: string;
  otpCode?: string;
}

export interface SmsSender {
  send(phone: string, message: string): Promise<void>;
}

@Injectable()
export class AuthService {
  private readonly log = new Logger(AuthService.name);
  private readonly otpPepper: string;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly tokens: TokenService,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
  ) {
    const pepper = process.env.OTP_PEPPER;
    if (!pepper || pepper.length < 32) {
      // Fail at boot, not at the first login attempt in production.
      throw new Error('OTP_PEPPER must be set to at least 32 characters');
    }
    this.otpPepper = pepper;
  }

  /* ------------------------------------------------------------------ OTP */

  /**
   * Send a one-time code.
   *
   * Always reports success, whether or not the number is registered — the reply
   * must not double as a "does this person have an account" oracle. Throttling
   * is the real control here, since every send costs money and an unthrottled
   * endpoint is both an enumeration tool and a way to run up an SMS bill.
   */
  async requestOtp(phone: string, purpose: 'LOGIN' | 'SIGNUP' | 'RESET', ctx: SessionContext = {}) {
    const normalised = this.normalisePhone(phone);
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const recent = await this.prisma.otpChallenge.findMany({
      where: { phone: normalised, createdAt: { gte: hourAgo } },
      orderBy: { createdAt: 'desc' },
      take: OTP_MAX_PER_HOUR,
    });
    if (recent.length >= OTP_MAX_PER_HOUR) {
      throw new BadRequestException('Too many codes requested. Try again in an hour.');
    }
    if (recent[0] && Date.now() - recent[0].createdAt.getTime() < OTP_RESEND_COOLDOWN_SECONDS * 1000) {
      const wait = Math.ceil((OTP_RESEND_COOLDOWN_SECONDS * 1000 - (Date.now() - recent[0].createdAt.getTime())) / 1000);
      throw new BadRequestException(`Wait ${wait} seconds before asking for another code.`);
    }

    const exists = await this.prisma.member.findUnique({ where: { phone: normalised }, select: { id: true } });
    if (purpose === 'SIGNUP' && exists) throw new ConflictException('This mobile number is already registered. Log in instead.');

    // For LOGIN and RESET on an unknown number: no challenge, no SMS, same reply.
    if (purpose !== 'SIGNUP' && !exists) {
      this.log.log(`OTP requested for unregistered number (${purpose})`);
      return { sent: true as const, expiresInMinutes: OTP_TTL_MINUTES };
    }

    // Supersede any outstanding code so only the newest one works.
    await this.prisma.otpChallenge.updateMany({
      where: { phone: normalised, purpose, consumed: false },
      data: { consumed: true },
    });

    const code = generateOtpCode(6);
    await this.prisma.otpChallenge.create({
      data: {
        phone: normalised,
        purpose,
        codeHash: hashOtpCode(code, this.otpPepper),
        expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000),
        ipAddress: ctx.ipAddress,
      },
    });

    await this.sms.send(normalised, `${code} is your Majestic Cart verification code. It expires in ${OTP_TTL_MINUTES} minutes. Never share it with anyone.`);
    return { sent: true as const, expiresInMinutes: OTP_TTL_MINUTES };
  }

  /**
   * Consume a code. Attempts are counted on the challenge itself, so guessing
   * burns the challenge rather than allowing 10^6 tries against a live code.
   */
  private async consumeOtp(phone: string, purpose: string, code: string): Promise<void> {
    const challenge = await this.prisma.otpChallenge.findFirst({
      where: { phone, purpose, consumed: false },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge) throw new BadRequestException('Request a new code.');
    if (challenge.expiresAt.getTime() <= Date.now()) {
      await this.prisma.otpChallenge.update({ where: { id: challenge.id }, data: { consumed: true } });
      throw new BadRequestException('That code has expired. Request a new one.');
    }
    if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
      await this.prisma.otpChallenge.update({ where: { id: challenge.id }, data: { consumed: true } });
      throw new BadRequestException('Too many wrong attempts. Request a new code.');
    }
    if (!otpMatches(challenge.codeHash, (code ?? '').trim(), this.otpPepper)) {
      await this.prisma.otpChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
      throw new BadRequestException('That code is not right.');
    }
    await this.prisma.otpChallenge.update({ where: { id: challenge.id }, data: { consumed: true } });
  }

  /* --------------------------------------------------------------- signup */

  /**
   * Create a member.
   *
   * Placement in the tree and both wallets are created in the same transaction
   * as the member row. A member without wallets would blow up at their first
   * order, and a member with a wrong ancestorPath would silently misroute every
   * commission above them — neither is something to leave to a second write.
   */
  async signup(input: SignupInput, ctx: SessionContext = {}): Promise<IssuedSession & { memberCode: string }> {
    const name = (input.name ?? '').trim().replace(/\s+/g, ' ');
    const phone = this.normalisePhone(input.phone);
    const email = (input.email ?? '').trim().toLowerCase() || null;

    if (name.length < 2) throw new BadRequestException('Enter your full name.');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new BadRequestException('Enter a valid email, or leave it blank.');

    const policy = checkPasswordPolicy(input.password, { phone, name, email: email ?? undefined });
    if (!policy.ok) throw new BadRequestException(policy.problems.join(' '));

    if (input.otpCode) await this.consumeOtp(phone, 'SIGNUP', input.otpCode);

    const passwordHash = await hashPassword(input.password);

    const created = await this.prisma.$transaction(async (tx) => {
      const sponsor = await this.resolveSponsor(tx, input.sponsorCode);
      const placement = childPath(sponsor);

      const series = await tx.$queryRaw<{ nextValue: number }[]>`
        INSERT INTO "NumberSeries" (key, prefix, "nextValue", "updatedAt")
        VALUES ('member', 'MC', 100002, NOW())
        ON CONFLICT (key) DO UPDATE SET "nextValue" = "NumberSeries"."nextValue" + 1, "updatedAt" = NOW()
        RETURNING "nextValue" - 1 AS "nextValue"
      `;
      const memberCode = formatMemberCode(series[0].nextValue);

      let member;
      try {
        member = await tx.member.create({
          data: {
            memberCode,
            name,
            phone,
            email,
            passwordHash,
            sponsorId: sponsor.id,
            ancestorPath: placement.ancestorPath,
            depth: placement.depth,
            lastDeviceId: input.deviceId,
            // Both wallets up front. Nothing can spend or earn without them.
            wallets: { create: [{ kind: 'SHOPPING' }, { kind: 'INCOME' }] },
          },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          const target = String((e.meta as any)?.target ?? '');
          if (target.includes('phone')) throw new ConflictException('This mobile number is already registered. Log in instead.');
          if (target.includes('email')) throw new ConflictException('This email is already registered.');
        }
        throw e;
      }

      if (input.deviceId) {
        await tx.deviceLink.upsert({
          where: { memberId_deviceId: { memberId: member.id, deviceId: input.deviceId } },
          create: { memberId: member.id, deviceId: input.deviceId },
          update: { lastSeen: new Date() },
        });
        const sharing = await tx.deviceLink.count({ where: { deviceId: input.deviceId } });
        const settings = await tx.storeSetting.findUnique({ where: { key: 'security' } });
        const limit = (settings?.value as any)?.maxAccountsPerDevice ?? 2;
        if (sharing > limit) {
          await tx.securityAlert.create({
            data: {
              severity: 'HIGH',
              type: 'MULTIPLE_ACCOUNTS',
              message: `${sharing} accounts now registered from one device`,
              memberId: member.id,
              refType: 'device',
              refId: input.deviceId,
            },
          });
        }
      }

      await tx.notification.create({
        data: {
          memberId: member.id,
          title: 'Welcome to Majestic Cart',
          body: `Your member ID is ${memberCode}. Recharge your wallet to start shopping and earning.`,
          kind: 'INFO',
        },
      });
      if (!sponsor.isCompany) {
        await tx.notification.create({
          data: {
            memberId: sponsor.id,
            title: 'New member in your team',
            body: `${name} (${memberCode}) joined with your sponsor ID.`,
            kind: 'TEAM',
          },
        });
      }
      await tx.auditLog.create({
        data: { actorType: 'MEMBER', actorId: member.id, action: 'member.signup', detail: { memberCode, sponsorId: sponsor.id }, ipAddress: ctx.ipAddress },
      });
      return member;
    });

    const session = await this.tokens.issue({ sub: created.id, typ: 'MEMBER', code: created.memberCode }, ctx);
    return { ...session, memberCode: created.memberCode };
  }

  private async resolveSponsor(tx: Prisma.TransactionClient, sponsorCode?: string) {
    const code = (sponsorCode ?? '').trim().toUpperCase();
    if (!code) {
      const company = await tx.member.findFirst({ where: { isCompany: true }, orderBy: { joinedAt: 'asc' } });
      if (!company) throw new BadRequestException('The network is not set up yet. Contact support.');
      return company;
    }
    const sponsor = await tx.member.findUnique({ where: { memberCode: code } });
    if (!sponsor) throw new BadRequestException(`Sponsor ID ${code} doesn't exist. Check it, or leave it blank to join under the company.`);
    if (sponsor.status !== 'ACTIVE') throw new BadRequestException('That sponsor account is on hold. Use a different sponsor ID.');
    return sponsor;
  }

  /* ---------------------------------------------------------- member login */

  async loginWithPassword(identifier: string, password: string, ctx: SessionContext = {}): Promise<IssuedSession> {
    const member = await this.findByIdentifier(identifier);

    // Hash even when there is no such member, so a missing account and a wrong
    // password take the same time. Without this, response latency alone reveals
    // which numbers are registered.
    if (!member) {
      await verifyPassword('$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$0000000000000000000000000000000000000000000', password);
      throw new UnauthorizedException(GENERIC_LOGIN_FAILURE);
    }

    if (isLockedOut(member)) throw new UnauthorizedException(lockoutMessage(member));

    const ok = await verifyPassword(member.passwordHash, password ?? '');
    if (!ok) {
      const next = nextLockout(member);
      await this.prisma.member.update({ where: { id: member.id }, data: next });
      throw new UnauthorizedException(GENERIC_LOGIN_FAILURE);
    }
    if (member.status !== 'ACTIVE') throw new UnauthorizedException('This account is on hold. Contact customer care.');

    // Upgrade the hash transparently if the cost parameters have moved on.
    const patch: Record<string, unknown> = { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() };
    if (passwordNeedsRehash(member.passwordHash)) patch.passwordHash = await hashPassword(password);
    if (ctx.deviceId) patch.lastDeviceId = ctx.deviceId;
    await this.prisma.member.update({ where: { id: member.id }, data: patch });

    if (ctx.deviceId) {
      await this.prisma.deviceLink.upsert({
        where: { memberId_deviceId: { memberId: member.id, deviceId: ctx.deviceId } },
        create: { memberId: member.id, deviceId: ctx.deviceId },
        update: { lastSeen: new Date() },
      });
    }

    return this.tokens.issue({ sub: member.id, typ: 'MEMBER', code: member.memberCode }, ctx);
  }

  async loginWithOtp(phone: string, code: string, ctx: SessionContext = {}): Promise<IssuedSession> {
    const normalised = this.normalisePhone(phone);
    await this.consumeOtp(normalised, 'LOGIN', code);

    const member = await this.prisma.member.findUnique({ where: { phone: normalised } });
    if (!member) throw new UnauthorizedException(GENERIC_LOGIN_FAILURE);
    if (member.status !== 'ACTIVE') throw new UnauthorizedException('This account is on hold. Contact customer care.');

    await this.prisma.member.update({
      where: { id: member.id },
      data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    return this.tokens.issue({ sub: member.id, typ: 'MEMBER', code: member.memberCode }, ctx);
  }

  /**
   * Reset via OTP. Every existing session is revoked: if the reset was done by
   * someone who had stolen access, leaving their refresh token alive would make
   * the whole exercise pointless.
   */
  async resetPassword(phone: string, code: string, newPassword: string): Promise<{ ok: true }> {
    const normalised = this.normalisePhone(phone);
    await this.consumeOtp(normalised, 'RESET', code);

    const member = await this.prisma.member.findUnique({ where: { phone: normalised } });
    if (!member) throw new BadRequestException('Request a new code.');

    const policy = checkPasswordPolicy(newPassword, { phone: normalised, name: member.name, email: member.email ?? undefined });
    if (!policy.ok) throw new BadRequestException(policy.problems.join(' '));

    await this.prisma.member.update({
      where: { id: member.id },
      data: { passwordHash: await hashPassword(newPassword), failedLogins: 0, lockedUntil: null },
    });
    const revoked = await this.tokens.revokeAllFor('MEMBER', member.id, 'Password reset');
    this.log.log(`Password reset for ${member.memberCode}, ${revoked} sessions revoked`);
    return { ok: true };
  }

  /* ----------------------------------------------------------- admin login */

  /**
   * Admin sign-in. Password and TOTP are checked in one call so the response
   * never reveals that the password alone was correct.
   */
  async loginAdmin(email: string, password: string, totpCode: string | undefined, ctx: SessionContext = {}): Promise<IssuedSession> {
    const admin = await this.prisma.adminUser.findUnique({
      where: { email: (email ?? '').trim().toLowerCase() },
      include: { role: true },
    });

    if (!admin) {
      await verifyPassword('$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHQ$0000000000000000000000000000000000000000000', password);
      throw new UnauthorizedException('That email or password is not right.');
    }
    if (isLockedOut(admin)) throw new UnauthorizedException(lockoutMessage(admin));

    const passwordOk = await verifyPassword(admin.passwordHash, password ?? '');
    let totpOk = true;
    let acceptedStep: number | undefined;

    if (admin.totpEnabled) {
      if (!admin.totpSecret) throw new UnauthorizedException('Two-factor is misconfigured on this account. Contact the system owner.');
      // Stored encrypted and bound to this admin's id, so a database dump does
      // not hand over a working 2FA seed — which would make the second factor
      // decorative. decryptIfNeeded tolerates rows written before the backfill.
      const secret = decryptIfNeeded(admin.totpSecret, encCtx.totpSecret(admin.id))!;
      const result = verifyTotp(secret, totpCode ?? '', { lastAcceptedStep: admin.lastTotpStep });
      totpOk = result.valid;
      acceptedStep = result.step;
      if (result.reason === 'REPLAYED') {
        this.log.warn(`Replayed TOTP code for admin ${admin.email} from ${ctx.ipAddress ?? 'unknown IP'}`);
      }
    }

    if (!passwordOk || !totpOk) {
      const next = nextLockout(admin, 5);
      await this.prisma.adminUser.update({ where: { id: admin.id }, data: next });
      await this.prisma.auditLog.create({
        data: {
          actorType: 'ADMIN',
          actorId: admin.id,
          action: 'admin.login.failed',
          detail: { reason: passwordOk ? 'totp' : 'password', failedLogins: next.failedLogins },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      if (next.failedLogins >= 3) {
        await this.prisma.securityAlert.upsert({
          where: { id: `admin-bruteforce-${admin.id}` },
          create: {
            id: `admin-bruteforce-${admin.id}`,
            severity: 'HIGH',
            type: 'ADMIN_BRUTEFORCE',
            message: `${next.failedLogins} failed admin sign-in attempts for ${admin.email}`,
          },
          update: { message: `${next.failedLogins} failed admin sign-in attempts for ${admin.email}`, resolved: false },
        });
      }
      throw new UnauthorizedException('That email or password is not right.');
    }

    await this.prisma.adminUser.update({
      where: { id: admin.id },
      data: {
        failedLogins: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        ...(acceptedStep != null ? { lastTotpStep: acceptedStep } : {}),
      },
    });
    await this.prisma.auditLog.create({
      data: { actorType: 'ADMIN', actorId: admin.id, action: 'admin.login', detail: { email: admin.email }, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
    });

    return this.tokens.issue({ sub: admin.id, typ: 'ADMIN', role: admin.role.name, permissions: admin.role.permissions }, ctx);
  }

  /**
   * Start (or restart) enrolment. Generates a fresh secret and stores it
   * encrypted immediately, but `totpEnabled` stays false until enableTotp()
   * confirms the admin actually scanned it and can produce a valid code —
   * otherwise a QR nobody scanned could lock the account out at next login.
   */
  async setupTotp(adminId: string): Promise<{ secret: string; otpauthUrl: string; qrUrl: string }> {
    const admin = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: adminId } });
    const secret = generateTotpSecret();
    await this.prisma.adminUser.update({
      where: { id: adminId },
      data: { totpSecret: encryptField(secret, encCtx.totpSecret(adminId)), totpEnabled: false, lastTotpStep: null },
    });
    const otpauthUrl = totpProvisioningUri({ secretBase32: secret, accountName: admin.email, issuer: 'Majestic Cart' });
    return { secret, otpauthUrl, qrUrl: await totpQrSvg(otpauthUrl) };
  }

  /** Confirms enrolment: a valid code proves the secret from setupTotp() actually made it into an authenticator app. */
  async enableTotp(adminId: string, code: string): Promise<void> {
    const admin = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: adminId } });
    if (!admin.totpSecret) throw new BadRequestException('Start setup again and scan the QR before entering a code.');
    const secret = decryptIfNeeded(admin.totpSecret, encCtx.totpSecret(adminId))!;
    const result = verifyTotp(secret, code, { lastAcceptedStep: admin.lastTotpStep });
    if (!result.valid) throw new BadRequestException('That code is not right. Check the time on your phone and try again.');
    await this.prisma.adminUser.update({ where: { id: adminId }, data: { totpEnabled: true, lastTotpStep: result.step } });
    await this.prisma.auditLog.create({ data: { actorType: 'ADMIN', actorId: adminId, action: 'admin.totp.enabled', detail: {} } });
  }

  /** Requires the password again — turning off the second factor is exactly the action a stolen session should not be able to take alone. */
  async disableTotp(adminId: string, password: string): Promise<void> {
    const admin = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: adminId } });
    const ok = await verifyPassword(admin.passwordHash, password ?? '');
    if (!ok) throw new UnauthorizedException('That password is not right.');
    await this.prisma.adminUser.update({ where: { id: adminId }, data: { totpEnabled: false, totpSecret: null, lastTotpStep: null } });
    await this.prisma.auditLog.create({ data: { actorType: 'ADMIN', actorId: adminId, action: 'admin.totp.disabled', detail: {} } });
  }

  /* -------------------------------------------------------------- helpers */

  private async findByIdentifier(identifier: string) {
    const raw = (identifier ?? '').trim();
    if (!raw) return null;
    if (/^\d{10}$/.test(raw.replace(/\D/g, '').slice(-10)) && /^[+\d\s-]+$/.test(raw)) {
      return this.prisma.member.findUnique({ where: { phone: this.normalisePhone(raw) } });
    }
    return this.prisma.member.findUnique({ where: { memberCode: raw.toUpperCase() } });
  }

  /**
   * Store the bare 10 digits. Members type +91, 0091, 091 and 0 prefixes
   * interchangeably, and a duplicate account created because "+919876500002"
   * did not match "9876500002" is a real support burden.
   */
  private normalisePhone(phone: string): string {
    const digits = (phone ?? '').replace(/\D/g, '');
    const local = digits.length > 10 ? digits.slice(-10) : digits;
    if (!/^[6-9]\d{9}$/.test(local)) throw new BadRequestException('Enter a valid 10-digit Indian mobile number.');
    return local;
  }
}
