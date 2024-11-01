import { Server as HTTPServer } from 'http';
import { Server, Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import jwt from 'jsonwebtoken';
import { config } from '../config/config';
import { redisClient, redisSubscriber, RedisService } from '../services/redis';
import { documentService } from '../services/documentService';
import { userService } from '../services/userService';
import {
  JoinDocumentSchema,
  DocumentEditSchema,
  PresenceUpdateSchema,
  JWTPayload,
} from '../models/types';
import { logger } from '../utils/logger';
import { Doc, encodeStateAsUpdate } from 'yjs';

// Connection tracking for metrics
const connectionMetrics = {
  totalConnections: 0,
  activeConnections: 0,
  peakConnections: 0,
  documentsWithEditors: new Map<string, Set<string>>(),
};

interface AuthenticatedSocket extends Socket {
  userId?: string;
  user?: any;
  joinedDocuments?: Set<string>;
  lastActivity?: number;
}

export const setupSocketIO = (server: HTTPServer): Server => {
  const io = new Server(server, {
    cors: {
      origin: config.frontendUrl,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
    // Performance optimizations
    pingTimeout: 30000, 
    pingInterval: 25000, 
    upgradeTimeout: 10000,
    maxHttpBufferSize: 1e6, 
    // Connection state recovery for reliability
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000, 
      skipMiddlewares: true,
    },
    // Adapter options for Redis scaling
    adapter: createAdapter(redisClient, redisSubscriber) as any,
  });

  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];

      if (!token) {
        return next(new Error('Authentication token required'));
      }

      const isBlacklisted = await RedisService.isTokenBlacklisted(token);
      if (isBlacklisted) {
        return next(new Error('Token has been invalidated'));
      }

      const decoded = jwt.verify(token, config.jwtSecret) as JWTPayload;
      const user = await userService.findById(decoded.userId);

      if (!user) {
        return next(new Error('User not found'));
      }

      socket.userId = user.id;
      socket.user = user;
      socket.joinedDocuments = new Set();
      socket.lastActivity = Date.now();
      next();
    } catch (error) {
      logger.error('Socket Authentication Error:', error);
      next(new Error('Invalid authentication token'));
    }
  });

  // Rate limiting middleware using Redis sliding window
  io.use(async (socket: AuthenticatedSocket, next) => {
    const { allowed, remaining, retryAfter } = await RedisService.incrementRateLimit(
      `socket:${socket.userId}`,
      60000, 
      300 
    );
    
    if (!allowed) {
      logger.warn(`Rate limit exceeded for socket user ${socket.userId}`);
      return next(new Error(`Rate limit exceeded. Retry after ${retryAfter} seconds`));
    }
    
    next();
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    // Update metrics
    connectionMetrics.totalConnections++;
    connectionMetrics.activeConnections++;
    connectionMetrics.peakConnections = Math.max(
      connectionMetrics.peakConnections,
      connectionMetrics.activeConnections
    );
    
    logger.info(`User ${socket.userId} connected (active: ${connectionMetrics.activeConnections})`);

    // Document join handler with optimized caching
    socket.on('document:join', async (data) => {
      try {
        const { documentId } = JoinDocumentSchema.parse(data);
        socket.lastActivity = Date.now();

        // Check if already joined
        if (socket.joinedDocuments?.has(documentId)) {
          logger.debug(`User ${socket.userId} already in document ${documentId}`);
          return;
        }

        const document = await documentService.findById(documentId, socket.userId!);
        if (!document) {
          socket.emit('error', { message: 'Document not found or access denied' });
          return;
        }

        socket.join(`document:${documentId}`);
        socket.joinedDocuments?.add(documentId);
        
        // Track editors per document
        if (!connectionMetrics.documentsWithEditors.has(documentId)) {
          connectionMetrics.documentsWithEditors.set(documentId, new Set());
        }
        connectionMetrics.documentsWithEditors.get(documentId)!.add(socket.userId!);

        // Fetch document state and presence in parallel for lower latency
        const [yjsDoc, presence] = await Promise.all([
          documentService.getYjsDocument(documentId),
          RedisService.getAllPresence(documentId),
        ]);
        
        const state = Buffer.from(encodeStateAsUpdate(yjsDoc as Doc)).toString('base64');

        // Send initial state and presence
        socket.emit('document:state', { documentId, state });
        socket.emit('presence:update', { documentId, users: presence });

        // Update presence and notify others
        await RedisService.setUserPresence(documentId, socket.userId!, {
          userId: socket.userId,
          name: socket.user.name,
          avatar: socket.user.avatar,
        });

        socket.to(`document:${documentId}`).emit('presence:join', {
          documentId,
          user: {
            userId: socket.userId,
            name: socket.user.name,
            avatar: socket.user.avatar,
          },
        });

        // Track operation for metrics
        await RedisService.incrementOperationCounter('document:join');
        
        logger.info(`User ${socket.userId} joined document ${documentId}`);
      } catch (error) {
        logger.error(`Error joining document ${data?.documentId}:`, error);
        socket.emit('error', { message: 'Failed to join document' });
      }
    });

    // Optimized document edit handler
    socket.on('document:edit', async (data) => {
      try {
        const { documentId, update } = DocumentEditSchema.parse(data);
        socket.lastActivity = Date.now();

        // Quick access check - user must have joined the document
        if (!socket.joinedDocuments?.has(documentId)) {
          socket.emit('error', { message: 'You must join the document first' });
          return;
        }

        const updateBuffer = Buffer.from(update, 'base64');
        await documentService.applyYjsUpdate(documentId, updateBuffer);

        // Broadcast to other users with minimal latency
        socket.to(`document:${documentId}`).emit('document:update', {
          documentId,
          update,
          userId: socket.userId,
          timestamp: Date.now(),
        });

        // Track operation for throughput metrics
        await RedisService.incrementOperationCounter('document:edit');
        
        logger.debug(`User ${socket.userId} edited document ${documentId}`);
      } catch (error) {
        logger.error(`Error handling document edit for ${data?.documentId}:`, error);
        socket.emit('error', { message: 'Failed to process document edit' });
      }
    });

    socket.on('presence:update', async (data) => {
      try {
        const { documentId, cursor, selection } = PresenceUpdateSchema.parse(data);
        socket.lastActivity = Date.now();
        
        await RedisService.setUserPresence(documentId, socket.userId!, {
          userId: socket.userId,
          name: socket.user.name,
          avatar: socket.user.avatar,
          cursor,
          selection,
        });

        // Broadcast to other users in the document
        socket.to(`document:${documentId}`).emit('presence:update', {
          documentId,
          userId: socket.userId,
          cursor,
          selection,
        });
      } catch (error) {
        logger.error('Error updating presence:', error);
      }
    });

    socket.on('document:leave', async (data) => {
      try {
        const { documentId } = JoinDocumentSchema.parse(data);
        await handleLeaveDocument(socket, documentId);
        logger.info(`User ${socket.userId} left document ${documentId}`);
      } catch (error) {
        logger.error(`Error leaving document ${data?.documentId}:`, error);
      }
    });

    socket.on('disconnect', async (reason) => {
      connectionMetrics.activeConnections--;
      logger.info(`User ${socket.userId} disconnected (reason: ${reason}, active: ${connectionMetrics.activeConnections})`);
      
      if (socket.joinedDocuments) {
        for (const documentId of socket.joinedDocuments) {
          await handleLeaveDocument(socket, documentId);
        }
      }
    });
    
    socket.on('error', (error) => {
      logger.error(`Socket error for user ${socket.userId}:`, error);
    });
  });
  
  // Helper function to handle leaving a document
  async function handleLeaveDocument(socket: AuthenticatedSocket, documentId: string): Promise<void> {
    socket.leave(`document:${documentId}`);
    socket.joinedDocuments?.delete(documentId);
    
    const editors = connectionMetrics.documentsWithEditors.get(documentId);
    if (editors) {
      editors.delete(socket.userId!);
      if (editors.size === 0) {
        connectionMetrics.documentsWithEditors.delete(documentId);
        // Force sync when last editor leaves
        await documentService.forceSyncDocument(documentId);
      }
    }
    
    await RedisService.removeUserPresence(documentId, socket.userId!);
    
    socket.to(`document:${documentId}`).emit('presence:leave', {
      documentId,
      userId: socket.userId,
    });
  }

  return io;
};

// Export metrics getter for monitoring
export const getSocketMetrics = () => ({
  ...connectionMetrics,
  documentsWithEditors: connectionMetrics.documentsWithEditors.size,
  editorsPerDocument: Object.fromEntries(
    Array.from(connectionMetrics.documentsWithEditors.entries()).map(
      ([docId, editors]) => [docId, editors.size]
    )
  ),
});