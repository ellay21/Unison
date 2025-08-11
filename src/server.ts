import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import dotenv from 'dotenv';
import passport from 'passport';
import rateLimit from 'express-rate-limit';

import { config } from './config/config';
import { setupPassport } from './config/passport';
import { redisClient } from './services/redis';
import { setupSocketIO } from './sockets/socketHandler';
import routes from './routes';
import { errorHandler } from './middleware/errorHandler';
import { logger } from './utils/logger';

dotenv.config();

const app = express();
const server = createServer(app);

// Rate limiting
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute per IP
  message: 'Too many requests from this IP, please try again later.',
});

// Middleware
app.use(limiter);
app.use(cors({
  origin: config.frontendUrl,
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(passport.initialize());

// Setup passport strategies
setupPassport();

// Routes
app.use('/api', routes);

// Error handling
app.use(errorHandler);

// Setup Socket.IO
const io = setupSocketIO(server);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Start server
const startServer = async () => {
  try {
    await redisClient.ping();
    logger.info('Redis connected successfully');

    server.listen(config.port, () => {
      logger.info(`Server running on port ${config.port}`);
      logger.info(`Environment: ${config.nodeEnv}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  server.close(() => {
    redisClient.disconnect();
    process.exit(0);
  });
});

startServer();

export { app, server, io };
