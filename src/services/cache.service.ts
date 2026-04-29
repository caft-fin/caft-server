// ─────────────────────────────────────────────────────────
// CAFT Financial — Redis Cache Service
// ─────────────────────────────────────────────────────────

import { getRedisClient } from '../config/redis';

export class CacheService {
  /**
   * Get a cached value, parsed from JSON
   */
  static async get<T>(key: string): Promise<T | null> {
    try {
      const redis = getRedisClient();
      const cached = await redis.get(key);
      if (!cached) return null;
      return JSON.parse(cached) as T;
    } catch (error) {
      console.warn(`⚠️  Cache get error for key "${key}":`, (error as Error).message);
      return null;
    }
  }

  /**
   * Set a cached value with TTL in seconds
   */
  static async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      const redis = getRedisClient();
      await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (error) {
      console.warn(`⚠️  Cache set error for key "${key}":`, (error as Error).message);
    }
  }

  /**
   * Delete a cached key
   */
  static async del(key: string): Promise<void> {
    try {
      const redis = getRedisClient();
      await redis.del(key);
    } catch (error) {
      console.warn(`⚠️  Cache del error for key "${key}":`, (error as Error).message);
    }
  }

  /**
   * Delete all keys matching a pattern
   */
  static async delPattern(pattern: string): Promise<void> {
    try {
      const redis = getRedisClient();
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch (error) {
      console.warn(`⚠️  Cache delPattern error for "${pattern}":`, (error as Error).message);
    }
  }

  /**
   * Get or set: return cached value, or compute and cache it
   */
  static async getOrSet<T>(key: string, ttlSeconds: number, computeFn: () => Promise<T>): Promise<T> {
    const cached = await CacheService.get<T>(key);
    if (cached !== null) return cached;

    const value = await computeFn();
    await CacheService.set(key, value, ttlSeconds);
    return value;
  }
}

// Cache key constants
export const CACHE_KEYS = {
  ACTIVE_PLANS: 'plans:active',
  PLAN: (id: string) => `plan:${id}`,
  USER_PROFILE: (id: string) => `user:${id}:profile`,
  USER_SUBSCRIPTION: (id: string) => `user:${id}:subscription`,
  STATS_OVERVIEW: 'stats:overview',
  OTP: (email: string) => `otp:${email}`,
} as const;

// Cache TTL constants (in seconds)
export const CACHE_TTL = {
  PLANS: 5 * 60,          // 5 minutes
  USER_PROFILE: 10 * 60,  // 10 minutes
  SUBSCRIPTION: 5 * 60,   // 5 minutes
  STATS: 2 * 60,          // 2 minutes
  OTP: 5 * 60,            // 5 minutes
} as const;
