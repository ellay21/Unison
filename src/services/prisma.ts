import { PrismaClient, Prisma } from '@prisma/client';
import { logger } from '../utils/logger';

declare global {
  var __prisma: PrismaClient | undefined;
}

const createPrismaClient = (): PrismaClient => {
  const client = new PrismaClient({
    log: [
      { level: 'query', emit: 'event' },
      { level: 'error', emit: 'stdout' },
      { level: 'warn', emit: 'stdout' },
    ],
  });

  // Log slow queries in development
  if (process.env.NODE_ENV === 'development') {
    client.$on('query' as never, (e: Prisma.QueryEvent) => {
      if (e.duration > 100) {
        logger.warn(`Slow query (${e.duration}ms):`, { query: e.query });
      }
    });
  }

  return client;
};

// Use singleton pattern to prevent multiple instances during hot reload
export const prisma = global.__prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  global.__prisma = prisma;
}

// Connection management
export const connectDatabase = async (): Promise<void> => {
  try {
    await prisma.$connect();
    logger.info('Database connected successfully');
  } catch (error) {
    logger.error('Failed to connect to database:', error);
    throw error;
  }
};

export const disconnectDatabase = async (): Promise<void> => {
  try {
    await prisma.$disconnect();
    logger.info('Database disconnected');
  } catch (error) {
    logger.error('Error disconnecting from database:', error);
  }
};

// Health check for database
export const checkDatabaseHealth = async (): Promise<{ healthy: boolean; latency?: number; error?: string }> => {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return {
      healthy: true,
      latency: Date.now() - start,
    };
  } catch (error) {
    return {
      healthy: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
};

// Transaction helper for batch operations
export const withTransaction = async <T>(
  fn: (tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>) => Promise<T>
): Promise<T> => {
  return prisma.$transaction(fn, {
    maxWait: 5000, 
    timeout: 10000, 
  });
};
