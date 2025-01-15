import { Request, Response, NextFunction } from 'express';
import { Socket } from 'socket.io';
import { RedisService } from '../services/redis';
import { logger } from '../utils/logger';

//Advanced Rate Limiting Configuration, it uses multiple tiers and sliding window
interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyPrefix: string;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

// Adaptive rate limts (Different rate limits for different endpoints)
// i used a Strict limits for auth endpoints to prevent brute force
export const rateLimitConfigs = {
  auth: {
    windowMs: 15 * 60 * 1000, 
    maxRequests: 5, 
    keyPrefix: 'ratelimit:auth',
  } as RateLimitConfig,
  
  // Standard API rate limit
  api: {
    windowMs: 60 * 1000, 
    maxRequests: 100, 
    keyPrefix: 'ratelimit:api',
  } as RateLimitConfig,
  
  // Document operations (slightly higher limit)
  documents: {
    windowMs: 60 * 1000, 
    maxRequests: 200, 
    keyPrefix: 'ratelimit:docs',
  } as RateLimitConfig,
  
  // Socket events (real-time, needs higher limits)
  socket: {
    windowMs: 60 * 1000, 
    maxRequests: 500, 
    keyPrefix: 'ratelimit:socket',
  } as RateLimitConfig,
  
  // Very strict for resource-intensive operations
  expensive: {
    windowMs: 60 * 60 * 1000, 
    maxRequests: 10, 
    keyPrefix: 'ratelimit:expensive',
  } as RateLimitConfig,
};

// Abuse tracking
const abuseTracker = new Map<string, { count: number; firstSeen: number; blocked: boolean }>();
const ABUSE_THRESHOLD = 10; 
const ABUSE_WINDOW = 60 * 60 * 1000; 
const BLOCK_DURATION = 24 * 60 * 60 * 1000; 

//Creates an Express rate limiting middleware with Redis sliding window

export const createRateLimiter = (config: RateLimitConfig) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    const identifier = getClientIdentifier(req);
    const key = `${config.keyPrefix}:${identifier}`;
    
    if (isBlocked(identifier)) {
      logger.warn(`Blocked abusive client: ${identifier}`);
      return res.status(429).json({
        error: 'Too Many Requests',
        message: 'Your access has been temporarily blocked due to abuse',
        retryAfter: getBlockTimeRemaining(identifier),
      });
    }
    
    try {
      const result = await RedisService.incrementRateLimit(
        key,
        config.windowMs,
        config.maxRequests
      );
      
      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', config.maxRequests);
      res.setHeader('X-RateLimit-Remaining', result.remaining);
      res.setHeader('X-RateLimit-Reset', Math.ceil(Date.now() / 1000) + Math.ceil(config.windowMs / 1000));
      
      if (!result.allowed) {
        // Track potential abuse
        trackAbuse(identifier);
        
        res.setHeader('Retry-After', result.retryAfter || Math.ceil(config.windowMs / 1000));
        logger.warn(`Rate limit exceeded for ${identifier} on ${req.path}`);
        
        return res.status(429).json({
          error: 'Too Many Requests',
          message: 'Rate limit exceeded. Please slow down.',
          retryAfter: result.retryAfter,
        });
      }
      
      next();
    } catch (error) {
      // On Redis error, allow request but log warning
      logger.error('Rate limit check failed:', error);
      next();
    }
  };
};

//Socket.IO rate limiting middleware
export const socketRateLimiter = async (socket: Socket, next: (err?: Error) => void) => {
  const identifier = socket.handshake.address || 'unknown';
  const userId = (socket as any).userId || identifier;
  const key = `${rateLimitConfigs.socket.keyPrefix}:${userId}`;
  
  if (isBlocked(identifier)) {
    return next(new Error('Access blocked due to abuse'));
  }
  
  try {
    const result = await RedisService.incrementRateLimit(
      key,
      rateLimitConfigs.socket.windowMs,
      rateLimitConfigs.socket.maxRequests
    );
    
    if (!result.allowed) {
      trackAbuse(identifier);
      return next(new Error(`Rate limit exceeded. Retry after ${result.retryAfter} seconds`));
    }
    
    next();
  } catch (error) {
    logger.error('Socket rate limit check failed:', error);
    next(); 
  }
};

//Get client identifier from request
function getClientIdentifier(req: Request): string {
  const user = (req as any).user;
  if (user?.id) {
    return `user:${user.id}`;
  }
  
  const forwarded = req.headers['x-forwarded-for'];
  const ip = typeof forwarded === 'string' 
    ? forwarded.split(',')[0].trim()
    : req.socket.remoteAddress || 'unknown';
    
  return `ip:${ip}`;
}

//Track potential abuse patterns
function trackAbuse(identifier: string): void {
  const now = Date.now();
  const tracker = abuseTracker.get(identifier);
  
  if (!tracker || now - tracker.firstSeen > ABUSE_WINDOW) {
    abuseTracker.set(identifier, { count: 1, firstSeen: now, blocked: false });
  } else {
    tracker.count++;
    
    if (tracker.count >= ABUSE_THRESHOLD && !tracker.blocked) {
      tracker.blocked = true;
      logger.warn(`Client ${identifier} blocked for abuse (${tracker.count} violations)`);
    }
  }
}

function isBlocked(identifier: string): boolean {
  const tracker = abuseTracker.get(identifier);
  if (!tracker || !tracker.blocked) return false;
  
  if (Date.now() - tracker.firstSeen > BLOCK_DURATION) {
    abuseTracker.delete(identifier);
    return false;
  }
  
  return true;
}

//Get remaining block time in seconds
function getBlockTimeRemaining(identifier: string): number {
  const tracker = abuseTracker.get(identifier);
  if (!tracker) return 0;
  
  const remaining = BLOCK_DURATION - (Date.now() - tracker.firstSeen);
  return Math.max(0, Math.ceil(remaining / 1000));
}

//Get abuse statistics for monitoring
export const getAbuseStats = () => ({
  trackedClients: abuseTracker.size,
  blockedClients: Array.from(abuseTracker.values()).filter(t => t.blocked).length,
  recentViolations: Array.from(abuseTracker.entries())
    .filter(([_, t]) => Date.now() - t.firstSeen < 60 * 60 * 1000)
    .map(([id, t]) => ({ identifier: id, violations: t.count, blocked: t.blocked })),
});

// Clean up old tracking data periodically
setInterval(() => {
  const now = Date.now();
  for (const [identifier, tracker] of abuseTracker) {
    if (now - tracker.firstSeen > BLOCK_DURATION) {
      abuseTracker.delete(identifier);
    }
  }
}, 60 * 60 * 1000); 

// Legacy middleware for backward compatibility
export const rateLimitMiddleware = socketRateLimiter;