// ─────────────────────────────────────────────────────────
// CAFT Financial — Redis Client Configuration
// ─────────────────────────────────────────────────────────

import Redis from 'ioredis';
import { env } from './env';

let redis: Redis;

export function getRedisClient(): Redis {
  if (!redis) {
    redis = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      lazyConnect: true,
    });

    redis.on('connect', () => {
      console.log('✅ Redis connected');
    });

    redis.on('error', (err) => {
      console.error('❌ Redis connection error:', err.message);
    });
  }

  return redis;
}

export async function connectRedis(): Promise<void> {
  const client = getRedisClient();
  try {
    await client.connect();
  } catch (err) {
    // If already connected, ignore
    if ((err as Error).message?.includes('already')) return;
    console.warn('⚠️  Redis connection failed, caching will be disabled:', (err as Error).message);
  }
}

export async function disconnectRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    console.log('🔌 Redis disconnected');
  }
}
