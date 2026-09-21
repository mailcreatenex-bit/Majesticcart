import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, Logger, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import Redis from 'ioredis';

/**
 * IP-based rate limiting for the handful of routes an attacker actually wants
 * to hammer: login, OTP, and password reset. Everything else is protected
 * indirectly (auth, ownership checks) rather than by request volume.
 *
 * This is deliberately separate from the per-account lockout in
 * `auth/credentials.ts`. Lockout stops someone guessing one member's
 * password; it does nothing about someone trying one password against ten
 * thousand phone numbers, or spraying OTP requests to run up the SMS bill.
 * Those are IP-shaped problems, so they need an IP-shaped control.
 *
 * Backed by Redis (the same instance BullMQ already requires) rather than
 * an in-process Map, because this API runs as more than one instance behind
 * the load balancer — a per-process counter would let an attacker get a full
 * budget from every instance in the pool.
 */

export const RATE_LIMIT = 'rate-limit:options';

export interface RateLimitOptions {
  /** Requests allowed per window. */
  points: number;
  /** Window length in seconds. */
  windowSeconds: number;
  /** Distinguishes routes sharing the guard so their counters don't collide. */
  keyPrefix: string;
}

/** Apply to a route alongside `@UseGuards(RateLimitGuard)`. */
export const RateLimit = (opts: RateLimitOptions) => SetMetadata(RATE_LIMIT, opts);

let client: Redis | null = null;

/** Lazily built, module-scoped: one connection shared by every guarded route. */
function redis(): Redis {
  if (!client) {
    client = new Redis({
      host: process.env.REDIS_HOST ?? '127.0.0.1',
      port: Number(process.env.REDIS_PORT ?? 6379),
      password: process.env.REDIS_PASSWORD,
      ...(process.env.REDIS_TLS === 'true' ? { tls: {} } : {}),
      // A rate limiter that itself blocks the request loop on a slow Redis is
      // worse than no rate limiter. Fail open (see canActivate) rather than
      // let a Redis hiccup take the login page down with it.
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
    client.on('error', (err) => new Logger('RateLimitGuard').warn(`Redis error: ${err.message}`));
  }
  return client;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly log = new Logger(RateLimitGuard.name);

  constructor(private readonly reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const opts = this.reflector.getAllAndOverride<RateLimitOptions | undefined>(RATE_LIMIT, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!opts) return true;

    const req = ctx.switchToHttp().getRequest<{ ip?: string; headers: Record<string, unknown> }>();
    // req.ip depends on `trust proxy` in main.ts already being set; without it
    // this key is the load balancer's address and the limit becomes shared by
    // every caller behind it.
    const ip = req.ip ?? 'unknown';
    const key = `ratelimit:${opts.keyPrefix}:${ip}`;

    try {
      const count = await redis().incr(key);
      if (count === 1) {
        await redis().expire(key, opts.windowSeconds);
      }
      if (count > opts.points) {
        const ttl = await redis().ttl(key);
        throw new HttpException(
          `Too many attempts. Try again in ${Math.max(ttl, 1)} seconds.`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      return true;
    } catch (err) {
      if (err instanceof HttpException) throw err;
      // Redis unreachable: fail open. The per-account lockout and OTP
      // per-phone throttle still apply, so this is a reduced defence, not no
      // defence — and it beats a Redis outage taking sign-in down entirely.
      this.log.warn(`Rate limit check failed open for ${opts.keyPrefix}: ${(err as Error).message}`);
      return true;
    }
  }
}
