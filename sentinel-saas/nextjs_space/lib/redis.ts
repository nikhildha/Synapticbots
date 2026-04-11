import Redis from 'ioredis';

// Singleton Redis instance
const globalForRedis = global as unknown as { redis: Redis };

export const redis =
  globalForRedis.redis ||
  new Redis(process.env.REDIS_URL || 'redis://default:arwwHDneBKbWLoVdqNcQvtKWKAUQzreP@redis.railway.internal:6379', {
    maxRetriesPerRequest: null,
    connectTimeout: 5000,
  });

if (process.env.NODE_ENV !== 'production') globalForRedis.redis = redis;

export default redis;
