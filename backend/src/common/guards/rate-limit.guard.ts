import {
  SetMetadata,
  applyDecorators,
  UseGuards,
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
  Optional,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";

export const RATE_LIMIT_KEY = "rate-limit";

export interface RateLimitConfig {
  /** Maximum number of requests allowed in the window. */
  max: number;
  /** Window duration in seconds. */
  windowSeconds: number;
  /** Optional key generator override (default: request IP). */
  keyGenerator?: (req: any) => string;
}

function isRateLimitDisabled(): boolean {
  if (process.env.DISABLE_RATE_LIMIT === "true") return true;
  if (process.env.NODE_ENV === "test") return true;
  return false;
}

/**
 * Decorator to apply rate limiting to a controller method.
 *
 * Example:
 *   @RateLimit({ max: 5, windowSeconds: 60 })
 *   @Post("login")
 *   async login(...) { ... }
 */
export const RateLimit = (config: RateLimitConfig) =>
  applyDecorators(
    SetMetadata(RATE_LIMIT_KEY, config),
    UseGuards(RateLimitGuard),
  );

/**
 * In-memory rate limiter store.
 * Not suitable for multi-instance production deployments (use Redis there),
 * but sufficient for single-instance development and test environments.
 */
class RateLimitStore {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();
  private readonly logger = new Logger(RateLimitStore.name);

  increment(key: string, max: number, windowSeconds: number): { allowed: boolean; remaining: number; resetAt: number } {
    const now = Date.now();
    const bucket = this.buckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
      // New window
      this.buckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
      return { allowed: true, remaining: max - 1, resetAt: now + windowSeconds * 1000 };
    }

    bucket.count++;
    const remaining = Math.max(0, max - bucket.count);
    return { allowed: bucket.count <= max, remaining, resetAt: bucket.resetAt };
  }

  cleanup() {
    const now = Date.now();
    for (const [key, bucket] of this.buckets.entries()) {
      if (now >= bucket.resetAt) {
        this.buckets.delete(key);
      }
    }
  }
}

const store = new RateLimitStore();

// Periodic cleanup of expired buckets (every 5 minutes)
setInterval(() => store.cleanup(), 5 * 60 * 1000);

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly reflector: Reflector;

  constructor(@Optional() reflector?: Reflector) {
    this.reflector = reflector || new Reflector();
  }

  canActivate(context: ExecutionContext): boolean {
    if (isRateLimitDisabled()) {
      return true;
    }

    const config = this.reflector.get<RateLimitConfig>(RATE_LIMIT_KEY, context.getHandler());
    if (!config) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const route = request.route?.path || request.routePath || request.path || request.originalUrl || "";
    const ip = request.ip || request.headers?.["x-forwarded-for"] || "127.0.0.1";
    const key = (config.keyGenerator ? config.keyGenerator(request) : ip) + ":" + route;

    const result = store.increment(key, config.max, config.windowSeconds);

    // Set rate limit headers
    const response = context.switchToHttp().getResponse();
    if (response?.setHeader) {
      response.setHeader("X-RateLimit-Limit", config.max);
      response.setHeader("X-RateLimit-Remaining", result.remaining);
      response.setHeader("X-RateLimit-Reset", Math.ceil(result.resetAt / 1000));
    }

    if (!result.allowed) {
      throw new ForbiddenException("Too many requests. Please try again later.");
    }

    return true;
  }
}
