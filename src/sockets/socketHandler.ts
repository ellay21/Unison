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

interface AuthenticatedSocket extends Socket {
  userId?: string;
  user?: any;
}

export const setupSocketIO = (server: HTTPServer): Server => {
  const io = new Server(server, {
    cors: {
      origin: config.frontendUrl,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });


  io.adapter(createAdapter(redisClient, redisSubscriber));

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
      next();
    } catch (error) {
      next(new Error('Invalid authentication token'));
    }
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    logger.info(`User ${socket.userId} connected`);

    socket.on('document:join', async (data) => {
      try {
        const { documentId } = JoinDocumentSchema.parse(data);

        const document = await documentService.findById(documentId, socket.userId!);
        if (!document) {
          socket.emit('error', { message: 'Document not found or access denied' });
          return;
        }

        socket.join(`document:${documentId}`);

        const yjsDoc = await documentService.getYjsDocument(documentId);
        const state = Buffer.from(encodeStateAsUpdate(yjsDoc as Doc)).toString('base64');

        socket.emit('document:state', {
          documentId,
          state,
        });

        const presence = await RedisService.getAllPresence(documentId);
        socket.emit('presence:update', {
          documentId,
          users: presence,
        });

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

        logger.info(`User ${socket.userId} joined document ${documentId}`);
      } catch (error) {
        logger.error('Error joining document:', error);
        socket.emit('error', { message: 'Failed to join document' });
      }
    });

    socket.on('document:edit', async (data) => {
      try {
        const { documentId, update } = DocumentEditSchema.parse(data);

        const document = await documentService.findById(documentId, socket.userId!);
        if (!document) {
          socket.emit('error', { message: 'Document not found or access denied' });
          return;
        }

        const updateBuffer = Buffer.from(update, 'base64');
        await documentService.applyYjsUpdate(documentId, updateBuffer);

        socket.to(`document:${documentId}`).emit('document:update', {
          documentId,
          update,
          userId: socket.userId,
        });

        logger.info(`User ${socket.userId} edited document ${documentId}`);
      } catch (error) {
        logger.error('Error handling document edit:', error);
        socket.emit('error', { message: 'Failed to process document edit' });
      }
    });

    socket.on('presence:update', async (data) => {
      try {
        const { documentId, cursor, selection } = PresenceUpdateSchema.parse(data);

        await RedisService.setUserPresence(documentId, socket.userId!, {
          userId: socket.userId,
          name: socket.user.name,
          avatar: socket.user.avatar,
          cursor,
          selection,
        });

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

        socket.leave(`document:${documentId}`);

        await RedisService.removeUserPresence(documentId, socket.userId!);

        // Notify others of user leaving
        socket.to(`document:${documentId}`).emit('presence:leave', {
          documentId,
          userId: socket.userId,
        });

        logger.info(`User ${socket.userId} left document ${documentId}`);
      } catch (error) {
        logger.error('Error leaving document:', error);
      }
    });

    socket.on('disconnect', async () => {
      logger.info(`User ${socket.userId} disconnected`);
    });

    socket.on('error', (error) => {
      logger.error('Socket error:', error);
    });
  });

  return io;
};