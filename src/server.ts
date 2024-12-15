import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import dotenv from 'dotenv';
import passport from 'passport';
import session from 'express-session'; 

import { config } from './config/config';
import { setupPassport } from './config/passport';
import { redisClient, RedisService } from './services/redis';
import { setupSocketIO, getSocketMetrics } from './sockets/socketHandler';
import routes from './routes';
import { errorHandler } from './middleware/errorHandler';
import { logger } from './utils/logger';
import { connectDatabase, disconnectDatabase, checkDatabaseHealth } from './services/prisma';
import { documentService } from './services/documentService';
import { createRateLimiter, rateLimitConfigs, getAbuseStats } from './middleware/rateLimitMiddleware';

dotenv.config();

const app = express();
const server = createServer(app);

const serverStartTime = Date.now();

// Apply rate limiting with Redis backed sliding window
const apiRateLimiter = createRateLimiter(rateLimitConfigs.api);
const authRateLimiter = createRateLimiter(rateLimitConfigs.auth);

// Middleware
app.use(cors({
  origin: config.frontendUrl,
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Session configuration
app.use(session({
  secret: config.sessionSecret!, 
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24, 
    secure: config.nodeEnv === 'production', 
    httpOnly: true,
    sameSite: 'lax',
  },
}));

app.use(passport.initialize());
app.use(passport.session()); 

setupPassport();

// Apply rate limiting to auth routes
app.use('/api/auth', authRateLimiter);

// Apply general rate limiting to API routes
app.use('/api', apiRateLimiter);

app.use('/api', routes);

app.use(errorHandler);

// Setup Socket.IO
const io = setupSocketIO(server);

app.get('/health', async (req, res) => {
  const [dbHealth, redisHealthy, redisLatency] = await Promise.all([
    checkDatabaseHealth(),
    RedisService.isHealthy(),
    RedisService.getLatency().catch(() => -1),
  ]);
  
  const socketMetrics = getSocketMetrics();
  const docStats = documentService.getStats();
  
  const healthy = dbHealth.healthy && redisHealthy;
  
  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - serverStartTime) / 1000),
    version: process.env.npm_package_version || '1.0.0',
    services: {
      database: {
        healthy: dbHealth.healthy,
        latency: dbHealth.latency,
        error: dbHealth.error,
      },
      redis: {
        healthy: redisHealthy,
        latency: redisLatency,
      },
    },
    metrics: {
      connections: {
        active: socketMetrics.activeConnections,
        peak: socketMetrics.peakConnections,
        total: socketMetrics.totalConnections,
      },
      documents: {
        cached: docStats.cachedDocuments,
        pendingUpdates: docStats.pendingUpdates,
        activeSyncs: docStats.activeSyncIntervals,
        withEditors: socketMetrics.documentsWithEditors,
      },
    },
  });
});

// Metrics endpoint for monitoring
app.get('/metrics', async (req, res) => {
  try {
    const [redisMemory, opsPerSecond] = await Promise.all([
      RedisService.getMemoryInfo(),
      RedisService.getOperationsPerSecond('document:edit'),
    ]);
    
    const socketMetrics = getSocketMetrics();
    const docStats = documentService.getStats();
    const abuseStats = getAbuseStats();
    
    res.json({
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - serverStartTime) / 1000),
      memory: {
        heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
        rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
        external: Math.round(process.memoryUsage().external / 1024 / 1024),
      },
      redis: {
        memoryUsed: Math.round(redisMemory.used / 1024 / 1024),
        memoryPeak: Math.round(redisMemory.peak / 1024 / 1024),
      },
      throughput: {
        documentEditsPerSecond: opsPerSecond,
      },
      connections: socketMetrics,
      documents: docStats,
      security: {
        trackedClients: abuseStats.trackedClients,
        blockedClients: abuseStats.blockedClients,
      },
    });
  } catch (error) {
    logger.error('Error fetching metrics:', error);
    res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

// Readiness probe for Kubernetes/container orchestration
app.get('/ready', async (req, res) => {
  const dbHealth = await checkDatabaseHealth();
  const redisHealthy = await RedisService.isHealthy();
  
  if (dbHealth.healthy && redisHealthy) {
    res.status(200).json({ ready: true });
  } else {
    res.status(503).json({ 
      ready: false,
      database: dbHealth.healthy,
      redis: redisHealthy,
    });
  }
});

// Liveness probe
app.get('/live', (req, res) => {
  res.status(200).json({ alive: true });
});

// Start server
const startServer = async () => {
  try {
    // Connect to database
    await connectDatabase();
    
    // Test Redis connection
    await redisClient.ping();
    logger.info('Redis connected successfully');

    server.listen(config.port, () => {
      logger.info(`Server running on port ${config.port}`);
      logger.info(`Environment: ${config.nodeEnv}`);
      logger.info(`Frontend URL: ${config.frontendUrl}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Graceful shutdown handler
const gracefulShutdown = async (signal: string) => {
  logger.info(`${signal} received, starting graceful shutdown...`);
  
  // Stop accepting new connections
  server.close(async () => {
    logger.info('HTTP server closed');
    
    try {
      // Flush pending document updates
      logger.info('Flushing pending document updates...');
      await documentService.cleanup();
      
      // Close database connection
      logger.info('Closing database connection...');
      await disconnectDatabase();
      
      // Close Redis connections
      logger.info('Closing Redis connections...');
      await redisClient.quit();
      
      logger.info('Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown:', error);
      process.exit(1);
    }
  });
  
  // Force shutdown after 30 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
};

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection', reason as Error, { promise: String(promise) });
});

startServer();

export { app, server, io };