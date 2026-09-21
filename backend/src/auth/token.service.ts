import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { hashToken } from './credentials';

/**
 * Session tokens.
 *
 * Access tokens are short-lived JWTs — stateless, so no database read per
 * request. Refresh tokens are opaque random strings stored as hashes, because
 * they are long-lived enough that a leaked database must not hand over live
 * sessions.
 */

export type SubjectType = 'MEMBER' | 'ADMIN';

export interface AccessClaims {
  sub: string;
  typ: SubjectType;
  code?: string; // memberCode, handy in logs
  role?: string; // admin only
}

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface SessionContext {
  ipAddress?: string;
  userAgent?: string;
  deviceId?: string;
}

const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_DAYS = 30;

@Injectable()
export class TokenService {
  private readonly log = new Logger(TokenService.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly jwt: JwtService,
  ) {}

  private signAccess(claims: AccessClaims): string {
    return this.jwt.sign(claims, { expiresIn: ACCESS_TTL_SECONDS });
  }

  /** Start a new session, meaning a new rotation family. */
  async issue(claims: AccessClaims, ctx: SessionContext = {}): Promise<IssuedSession> {
    const familyId = randomBytes(16).toString('hex');
    return this.mint(claims, familyId, ctx);
  }

  private async mint(claims: AccessClaims, familyId: string, ctx: SessionContext): Promise<IssuedSession> {
    // 256 bits of opaque randomness. Only its hash is persisted.
    const refreshToken = randomBytes(32).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        familyId,
        tokenHash: hashToken(refreshToken),
        subjectType: claims.typ,
        subjectId: claims.sub,
        expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000),
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        deviceId: ctx.deviceId,
      },
    });
    return { accessToken: this.signAccess(claims), refreshToken, expiresIn: ACCESS_TTL_SECONDS };
  }

  /**
   * Exchange a refresh token for a new pair, rotating it.
   *
   * The theft case: an attacker copies a refresh token. Whoever uses it second
   * presents a token already marked used. We cannot tell victim from attacker,
   * so the entire family is revoked and both are forced to log in again. Losing
   * a session is a small price for catching a stolen one.
   */
  async rotate(presented: string, ctx: SessionContext = {}): Promise<IssuedSession> {
    const tokenHash = hashToken(presented ?? '');
    const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!record) throw new UnauthorizedException('Your session has expired. Log in again.');

    if (record.usedAt) {
      // Replay. Burn the family.
      await this.revokeFamily(record.familyId, 'Refresh token reuse detected');
      this.log.warn(
        `Refresh token replay on family ${record.familyId} (${record.subjectType} ${record.subjectId}) from ${ctx.ipAddress ?? 'unknown IP'}`,
      );
      throw new UnauthorizedException('Your session was ended for security reasons. Log in again.');
    }
    if (record.revokedAt) throw new UnauthorizedException('Your session was ended. Log in again.');
    if (record.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Your session has expired. Log in again.');
    }

    const claims = await this.claimsFor(record.subjectType as SubjectType, record.subjectId);

    // Mark used and mint the replacement in one transaction, so a crash between
    // the two cannot leave the caller with no usable token.
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.refreshToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (claimed.count === 0) {
        // Lost a race with a concurrent rotation — treat as replay.
        await this.revokeFamily(record.familyId, 'Concurrent refresh detected');
        throw new UnauthorizedException('Your session was ended for security reasons. Log in again.');
      }
      return this.mint(claims, record.familyId, ctx);
    });
  }

  private async claimsFor(typ: SubjectType, id: string): Promise<AccessClaims> {
    if (typ === 'ADMIN') {
      const admin = await this.prisma.adminUser.findUnique({ where: { id } });
      if (!admin) throw new UnauthorizedException('This account no longer exists.');
      return { sub: admin.id, typ: 'ADMIN', role: admin.role };
    }
    const member = await this.prisma.member.findUnique({ where: { id } });
    if (!member) throw new UnauthorizedException('This account no longer exists.');
    // A member put on hold mid-session loses it at the next refresh, within the
    // 15-minute access token window rather than in 30 days.
    if (member.status !== 'ACTIVE') throw new UnauthorizedException('This account is on hold. Contact support.');
    return { sub: member.id, typ: 'MEMBER', code: member.memberCode };
  }

  async revokeFamily(familyId: string, reason: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  /** Log out everywhere — use after a password change or a security incident. */
  async revokeAllFor(typ: SubjectType, subjectId: string, reason: string): Promise<number> {
    const res = await this.prisma.refreshToken.updateMany({
      where: { subjectType: typ, subjectId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return res.count;
  }

  async logout(presented: string): Promise<void> {
    const record = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(presented ?? '') } });
    if (record) await this.revokeFamily(record.familyId, 'Signed out');
  }

  /** Nightly cleanup. Expired rows carry no value and the table only grows. */
  async purgeExpired(olderThanDays = 7): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    const res = await this.prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: cutoff } } });
    return res.count;
  }
}
