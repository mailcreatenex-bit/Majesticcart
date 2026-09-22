import {
  CanActivate, ExecutionContext, Injectable, SetMetadata, UnauthorizedException,
  ForbiddenException, createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AccessClaims, SubjectType } from './token.service';

/**
 * Route protection.
 *
 * The guard is registered globally, so a route is protected unless it opts out
 * with @Public(). Opt-out beats opt-in here: forgetting a decorator then leaves
 * an endpoint locked rather than wide open, and on a platform holding member
 * funds that is the failure you want.
 */

export const IS_PUBLIC = 'auth:public';
export const REQUIRED_SUBJECT = 'auth:subject';
export const REQUIRED_PERMISSIONS = 'auth:permissions';

export const Public = () => SetMetadata(IS_PUBLIC, true);
export const MemberOnly = () => SetMetadata(REQUIRED_SUBJECT, 'MEMBER' as SubjectType);

/** Any signed-in admin, regardless of role — for self-service routes (own login, own 2FA, "who am I"). */
export const AdminOnly = () => SetMetadata(REQUIRED_SUBJECT, 'ADMIN' as SubjectType);

/**
 * An admin whose role carries every one of these permission keys (see
 * `permissions.ts`). This is the real access-control point — everything
 * `AdminShell` hides or shows client-side is a convenience, never the
 * enforcement.
 */
export const RequirePermission = (...permissions: string[]) => {
  const decorators = [
    SetMetadata(REQUIRED_SUBJECT, 'ADMIN' as SubjectType),
    SetMetadata(REQUIRED_PERMISSIONS, permissions),
  ];
  return (target: any, key?: any, descriptor?: any) => {
    for (const d of decorators) d(target, key, descriptor);
  };
};

export interface RequestWithAuth {
  auth?: AccessClaims;
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  cookies?: Record<string, string>;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<RequestWithAuth>();
    const token = extractBearer(req);
    if (!token) throw new UnauthorizedException('Sign in to continue.');

    let claims: AccessClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessClaims>(token);
    } catch {
      // Expired and forged tokens are reported identically. The client's job is
      // to refresh on 401 either way.
      throw new UnauthorizedException('Your session has expired. Log in again.');
    }

    const requiredSubject = this.reflector.getAllAndOverride<SubjectType>(REQUIRED_SUBJECT, targets);
    if (requiredSubject && claims.typ !== requiredSubject) {
      // A member token on an admin route is a 403, not a 404: pretending the
      // route does not exist just makes support calls harder to diagnose.
      throw new ForbiddenException('You do not have access to this.');
    }

    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(REQUIRED_PERMISSIONS, targets);
    if (requiredPermissions?.length) {
      const granted = claims.permissions ?? [];
      if (!requiredPermissions.every((p) => granted.includes(p))) {
        throw new ForbiddenException('Your role does not allow this action.');
      }
    }

    req.auth = claims;
    return true;
  }
}

function extractBearer(req: RequestWithAuth): string | null {
  const header = req.headers?.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return null;
  const [scheme, token] = value.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token.trim() : null;
}

/** The authenticated subject, or a named claim from it. */
export const CurrentUser = createParamDecorator((field: keyof AccessClaims | undefined, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<RequestWithAuth>();
  if (!req.auth) throw new UnauthorizedException('Sign in to continue.');
  return field ? req.auth[field] : req.auth;
});

/**
 * IP, user agent and device id, for session records and fraud signals.
 *
 * Trusting X-Forwarded-For blindly lets a caller spoof their own IP, which
 * would poison the security alerts that depend on it. Enable Nest's trust proxy
 * setting and read `req.ip` instead of parsing the header here.
 */
export const ClientContext = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<RequestWithAuth>();
  const header = (name: string): string | undefined => {
    const v = req.headers?.[name];
    return Array.isArray(v) ? v[0] : v;
  };
  return {
    ipAddress: req.ip,
    userAgent: header('user-agent'),
    deviceId: header('x-device-id'),
  };
});
