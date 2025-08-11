import { Socket } from 'socket.io';
import { throttle } from 'lodash'; 
import { logger } from '../utils/logger';

// Store last update time for each user and document
const lastUpdateTimes = new Map<string, number>();

// A simple rate-limiting middleware for document editing
export const rateLimitMiddleware = (socket: Socket, next: any) => {
  const ONE_SECOND = 1000;
  const RATE_LIMIT_MS = 250; // Allow one update every 250ms

  const throttledEdit = throttle(() => {
    socket.emit('error', { message: 'Rate limit exceeded. Please slow down.' });
    logger.warn(`Rate limit exceeded for user ${socket.id}`);
  }, RATE_LIMIT_MS, { trailing: false }); // Throttle trailing edge calls

  socket.on('document:edit', (data, callback) => {
    const now = Date.now();
    const lastUpdate = lastUpdateTimes.get(socket.id) || 0;

    if (now - lastUpdate < RATE_LIMIT_MS) {
      throttledEdit();
      if (callback) callback({ error: 'Rate limit exceeded' });
      return;
    }

    lastUpdateTimes.set(socket.id, now);
    next(); 
  });

  next();
};