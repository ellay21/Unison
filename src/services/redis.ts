import Redis from 'ioredis';
import { config } from '../config/config';
import { logger } from '../utils/logger';

// Custom retry strategy for ioredis
const retryStrategy = (times: number) => {
  const delay = Math.min(times * 100, 2000); 
  logger.warn(`Redis connection failed. Retrying in ${delay}ms...`);
  return delay;
};

// Common options for both client and subscriber
const redisOptions = {
  retryStrategy,
  lazyConnect: true,
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  family: 4, // IPv4
  keepAlive: 30000, 
  connectTimeout: 10000, 
};

export const redisClient = new Redis(config.redisUrl, redisOptions);
export const redisSubscriber = new Redis(config.redisUrl, redisOptions);

// Connection state tracking
let isRedisConnected = false;

redisClient.on('connect', () => {
  isRedisConnected = true;
  logger.info('Redis client connected');
});

redisClient.on('error', (error) => {
  isRedisConnected = false;
  logger.error('Redis client error:', error);
});

redisClient.on('close', () => {
  isRedisConnected = false;
  logger.warn('Redis connection closed');
});

redisSubscriber.on('connect', () => {
  logger.info('Redis subscriber connected');
});

redisSubscriber.on('error', (error) => {
  logger.error('Redis subscriber error:', error);
});

export class RedisService {
  // Check Redis health
  static async isHealthy(): Promise<boolean> {
    try {
      const pong = await redisClient.ping();
      return pong === 'PONG';
    } catch {
      return false;
    }
  }
  
  static async getLatency(): Promise<number> {
    const start = Date.now();
    await redisClient.ping();
    return Date.now() - start;
  }
  
  static async blacklistToken(token: string, expiresIn: number): Promise<void> {
    await redisClient.setex(`blacklist:${token}`, expiresIn, '1');
  }

  static async isTokenBlacklisted(token: string): Promise<boolean> {
    const result = await redisClient.get(`blacklist:${token}`);
    return result === '1';
  }

  // Presence tracking with pipeline for efficiency
  static async setUserPresence(documentId: string, userId: string, presence: any): Promise<void> {
    const key = `presence:${documentId}`;
    const pipeline = redisClient.pipeline();
    
    pipeline.hset(key, userId, JSON.stringify({
      ...presence,
      lastSeen: Date.now(),
    }));
    pipeline.expire(key, 3600); 
    
    await pipeline.exec();
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
  
  // Batch presence update for multiple users
  static async batchSetUserPresence(updates: Array<{ documentId: string; userId: string; presence: any }>): Promise<void> {
    const pipeline = redisClient.pipeline();
    
    for (const { documentId, userId, presence } of updates) {
      const key = `presence:${documentId}`;
      pipeline.hset(key, userId, JSON.stringify({
        ...presence,
        lastSeen: Date.now(),
      }));
      pipeline.expire(key, 3600);
    }
    
    await pipeline.exec();
  }

  // Document state caching with optimized TTL
  static async cacheDocumentState(documentId: string, state: string): Promise<void> {
    const key = `document:${documentId}:state`;
    await redisClient.setex(key, 600, state); // 10 minutes TTL (increased from 5)
  }

  static async getCachedDocumentState(documentId: string): Promise<string | null> {
    const key = `document:${documentId}:state`;
    return await redisClient.get(key);
  }
  
  // Invalidate document cache
  static async invalidateDocumentCache(documentId: string): Promise<void> {
    const key = `document:${documentId}:state`;
    await redisClient.del(key);
  }
  
  // Batch cache operations using pipeline
  static async batchCacheDocumentStates(documents: Array<{ documentId: string; state: string }>): Promise<void> {
    const pipeline = redisClient.pipeline();
    
    for (const { documentId, state } of documents) {
      const key = `document:${documentId}:state`;
      pipeline.setex(key, 600, state);
    }
    
    await pipeline.exec();
  }
  
  // Operation counter for throughput tracking
  static async incrementOperationCounter(operation: string): Promise<number> {
    const key = `ops:${operation}:${Math.floor(Date.now() / 1000)}`;
    const pipeline = redisClient.pipeline();
    pipeline.incr(key);
    pipeline.expire(key, 60); 
    const results = await pipeline.exec();
    return results?.[0]?.[1] as number || 0;
  }
  
  static async getOperationsPerSecond(operation: string): Promise<number> {
    const currentSecond = Math.floor(Date.now() / 1000);
    const key = `ops:${operation}:${currentSecond}`;
    const count = await redisClient.get(key);
    return parseInt(count || '0', 10);
  }

  // Rate limiting helper with sliding window
  static async incrementRateLimit(key: string, windowMs: number, maxRequests: number): Promise<{ allowed: boolean; remaining: number; retryAfter?: number }> {
    const now = Date.now();
    const windowKey = `ratelimit:${key}`;
    
    // Use sorted set for sliding window
    const pipeline = redisClient.pipeline();

    // Remove old entries outside the window
    pipeline.zremrangebyscore(windowKey, 0, now - windowMs);
    pipeline.zadd(windowKey, now.toString(), `${now}-${Math.random()}`);
    pipeline.zcard(windowKey);
    pipeline.expire(windowKey, Math.ceil(windowMs / 1000));
    
    const results = await pipeline.exec();
    const current = results?.[2]?.[1] as number || 0;
    
    if (current > maxRequests) {
      // Get oldest entry to calculate retry-after
      const oldest = await redisClient.zrange(windowKey, 0, 0, 'WITHSCORES');
      const retryAfter = oldest.length >= 2 
        ? Math.ceil((parseInt(oldest[1]) + windowMs - now) / 1000)
        : Math.ceil(windowMs / 1000);
      
      return {
        allowed: false,
        remaining: 0,
        retryAfter,
      };
    }
    
    return {
      allowed: true,
      remaining: Math.max(0, maxRequests - current),
    };
  }
  
  // Distributed lock for concurrent operations
  static async acquireLock(lockKey: string, ttlMs: number = 5000): Promise<string | null> {
    const lockId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const result = await redisClient.set(
      `lock:${lockKey}`,
      lockId,
      'PX',
      ttlMs,
      'NX'
    );
    return result === 'OK' ? lockId : null;
  }
  
  static async releaseLock(lockKey: string, lockId: string): Promise<boolean> {
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    const result = await redisClient.eval(script, 1, `lock:${lockKey}`, lockId);
    return result === 1;
  }
  
  // Pub/sub for real-time document updates across server instances
  static async publishDocumentUpdate(documentId: string, update: any): Promise<void> {
    await redisClient.publish(`document:${documentId}`, JSON.stringify(update));
  }
  
  static subscribeToDocumentUpdates(documentId: string, callback: (update: any) => void): void {
    redisSubscriber.subscribe(`document:${documentId}`);
    redisSubscriber.on('message', (channel, message) => {
      if (channel === `document:${documentId}`) {
        callback(JSON.parse(message));
      }
    });
  }
  
  static unsubscribeFromDocumentUpdates(documentId: string): void {
    redisSubscriber.unsubscribe(`document:${documentId}`);
  }
  
  // Get Redis memory info for monitoring
  static async getMemoryInfo(): Promise<{ used: number; peak: number }> {
    const info = await redisClient.info('memory');
    const usedMatch = info.match(/used_memory:(\d+)/);
    const peakMatch = info.match(/used_memory_peak:(\d+)/);
    return {
      used: usedMatch ? parseInt(usedMatch[1]) : 0,
      peak: peakMatch ? parseInt(peakMatch[1]) : 0,
    };
  }
}