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

// In-memory fallback store for when Redis is unavailable
const memoryStore = new Map<string, { count: number; expiresAt: number }>();

// Periodically clean expired entries from memory store (every 60 seconds).
// The handle is exported so the shutdown handler in index.ts can clear it
// and prevent the process from being kept alive past SIGTERM/SIGINT.
export const memoryStoreCleanupInterval: NodeJS.Timeout = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of memoryStore) {
    if (entry.expiresAt <= now) memoryStore.delete(key);
  }
}, 60_000);

export function rateLimiter(options: RateLimitOptions) {
  const { windowMs, maxRequests, keyPrefix = 'ratelimit' } = options;
  const windowSec = Math.ceil(windowMs / 1000);

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${keyPrefix}:${ip}`;

    try {
      const redis = getRedisClient();
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
    } catch {
      // Redis is down — use in-memory fallback (never skip rate limiting)
      const now = Date.now();
      const entry = memoryStore.get(key);

      if (!entry || entry.expiresAt <= now) {
        memoryStore.set(key, { count: 1, expiresAt: now + windowMs });
        next();
        return;
      }

      entry.count += 1;

      res.set({
        'X-RateLimit-Limit': maxRequests.toString(),
        'X-RateLimit-Remaining': Math.max(0, maxRequests - entry.count).toString(),
        'X-RateLimit-Reset': new Date(entry.expiresAt).toISOString(),
      });

      if (entry.count > maxRequests) {
        ApiResponse.error(res, 'Too many requests, please try again later', 429);
        return;
      }

      next();
    }
  };
}

// Pre-configured limiters
export const authLimiter = rateLimiter({
  windowMs: 60 * 1000,   // 1 minute
  maxRequests: 20,
  keyPrefix: 'ratelimit:auth',
});

export const apiLimiter = rateLimiter({
  windowMs: 60 * 1000,   // 1 minute
  maxRequests: 100,
  keyPrefix: 'ratelimit:api',
});

export const webhookLimiter = rateLimiter({
  windowMs: 60 * 1000,   // 1 minute
  maxRequests: 100,
  keyPrefix: 'ratelimit:webhook',
});
