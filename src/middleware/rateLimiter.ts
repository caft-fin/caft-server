// ─────────────────────────────────────────────────────────
// CAFT Financial — Rate Limiter Middleware (Redis-backed)
// ─────────────────────────────────────────────────────────

import { Request, Response, NextFunction } from 'express';
import { getRedisClient } from '../config/redis';
import { ApiResponse } from '../utils/apiResponse';

interface RateLimitOptions {
  windowMs: number;    // Time window in milliseconds
  maxRequests: number; // Max requests per window
  keyPrefix?: string;  // Redis key prefix
}

export function rateLimiter(options: RateLimitOptions) {
  const { windowMs, maxRequests, keyPrefix = 'ratelimit' } = options;
  const windowSec = Math.ceil(windowMs / 1000);

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const redis = getRedisClient();
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const key = `${keyPrefix}:${ip}`;

      const current = await redis.incr(key);

      if (current === 1) {
        await redis.expire(key, windowSec);
      }

      // Set rate limit headers
      res.set({
        'X-RateLimit-Limit': maxRequests.toString(),
        'X-RateLimit-Remaining': Math.max(0, maxRequests - current).toString(),
        'X-RateLimit-Reset': new Date(Date.now() + windowMs).toISOString(),
      });

      if (current > maxRequests) {
        ApiResponse.error(res, 'Too many requests, please try again later', 429);
        return;
      }

      next();
    } catch (error) {
      // If Redis is down, let the request through
      console.warn('⚠️  Rate limiter error, allowing request:', (error as Error).message);
      next();
    }
  };
}

// Pre-configured limiters
export const authLimiter = rateLimiter({
  windowMs: 60 * 1000,   // 1 minute
  maxRequests: 5,
  keyPrefix: 'ratelimit:auth',
});

export const apiLimiter = rateLimiter({
  windowMs: 60 * 1000,   // 1 minute
  maxRequests: 60,
  keyPrefix: 'ratelimit:api',
});

export const webhookLimiter = rateLimiter({
  windowMs: 60 * 1000,   // 1 minute
  maxRequests: 100,
  keyPrefix: 'ratelimit:webhook',
});
