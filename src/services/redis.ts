import Redis from 'ioredis';
import { config } from '../config/config';
import { logger } from '../utils/logger';

// Custom retry strategy for ioredis
const retryStrategy = (times: number) => {
  const delay = Math.min(times * 100, 2000); // Exponential backoff with a max delay of 2 seconds
  logger.warn(`Redis connection failed. Retrying in ${delay}ms...`);
  return delay;
};

// Common options for both client and subscriber
const redisOptions = {
  retryStrategy,
  lazyConnect: true,
};

export const redisClient = new Redis(config.redisUrl, redisOptions);
export const redisSubscriber = new Redis(config.redisUrl, redisOptions);

redisClient.on('connect', () => {
  logger.info('Redis client connected');
});

redisClient.on('error', (error) => {
  logger.error('Redis client error:', error);
});

redisSubscriber.on('connect', () => {
  logger.info('Redis subscriber connected');
});

redisSubscriber.on('error', (error) => {
  logger.error('Redis subscriber error:', error);
});

// Redis service functions
export class RedisService {
  static async blacklistToken(token: string, expiresIn: number): Promise<void> {
    await redisClient.setex(`blacklist:${token}`, expiresIn, '1');
  }

  static async isTokenBlacklisted(token: string): Promise<boolean> {
    const result = await redisClient.get(`blacklist:${token}`);
    return result === '1';
  }

  // Presence tracking
  static async setUserPresence(documentId: string, userId: string, presence: any): Promise<void> {
    const key = `presence:${documentId}`;
    await redisClient.hset(key, userId, JSON.stringify({
      ...presence,
      lastSeen: Date.now(),
    }));
    await redisClient.expire(key, 3600); // 1 hour TTL
  }

  static async getUserPresence(documentId: string, userId: string): Promise<any | null> {
    const key = `presence:${documentId}`;
    const presence = await redisClient.hget(key, userId);
    return presence ? JSON.parse(presence) : null;
  }

  static async getAllPresence(documentId: string): Promise<Record<string, any>> {
    const key = `presence:${documentId}`;
    const presenceData = await redisClient.hgetall(key);
    const result: Record<string, any> = {};
    
    for (const [userId, data] of Object.entries(presenceData)) {
      result[userId] = JSON.parse(data);
    }
    
    return result;
  }

  static async removeUserPresence(documentId: string, userId: string): Promise<void> {
    const key = `presence:${documentId}`;
    await redisClient.hdel(key, userId);
  }

  // Document state caching
  static async cacheDocumentState(documentId: string, state: string): Promise<void> {
    const key = `document:${documentId}:state`;
    await redisClient.setex(key, 300, state); 
  }

  static async getCachedDocumentState(documentId: string): Promise<string | null> {
    const key = `document:${documentId}:state`;
    return await redisClient.get(key);
  }

  // Rate limiting helper
  static async incrementRateLimit(key: string, windowMs: number, maxRequests: number): Promise<{ allowed: boolean; remaining: number }> {
    const current = await redisClient.incr(key);
    
    if (current === 1) {
      await redisClient.expire(key, Math.ceil(windowMs / 1000));
    }
    
    return {
      allowed: current <= maxRequests,
      remaining: Math.max(0, maxRequests - current),
    };
  }
}