import { Doc, encodeStateAsUpdate, applyUpdate } from 'yjs'; 
import { CreateDocument, UpdateDocument } from '../models/types';
import { RedisService } from './redis';
import { logger } from '../utils/logger';
import { prisma, withTransaction } from './prisma';
import { collaborationService } from './collaborationService';

// Configuration constants for performance tuning
const SYNC_INTERVAL_MS = 5000; // Database sync interval
const BATCH_WRITE_THRESHOLD = 10; // Number of pending updates before force sync
const MAX_PENDING_UPDATES = 100; // Maximum pending updates per document

interface PendingUpdate {
  documentId: string;
  state: string;
  timestamp: number;
}

export class DocumentService {
  private documentSyncInterval: Map<string, NodeJS.Timeout> = new Map();
  private pendingUpdates: Map<string, PendingUpdate> = new Map();
  private updateCount: Map<string, number> = new Map();
  private yjsDocumentCache: Map<string, { doc: Doc; lastAccess: number }> = new Map();
  
  // Cache cleanup interval
  private cacheCleanupInterval: NodeJS.Timeout | null = null;
  
  constructor() {
    // Clean up stale cache entries every 5 minutes
    this.cacheCleanupInterval = setInterval(() => this.cleanupCache(), 5 * 60 * 1000);
  }
  
  private cleanupCache(): void {
    const now = Date.now();
    const maxAge = 10 * 60 * 1000; 
    
    for (const [docId, cached] of this.yjsDocumentCache) {
      if (now - cached.lastAccess > maxAge) {
        this.yjsDocumentCache.delete(docId);
        logger.debug(`Cleaned up cached Yjs document: ${docId}`);
      }
    }
  }

  async create(userId: string, documentData: CreateDocument) {
    // Create new Yjs document
    const yjsDoc = new Doc();
    const text = yjsDoc.getText('content');
    text.insert(0, documentData.content || '');
    
    const serializedState = Buffer.from(encodeStateAsUpdate(yjsDoc)).toString('base64');
    
    const document = await prisma.document.create({
      data: {
        title: documentData.title,
        content: serializedState,
        ownerId: userId,
      },
      include: {
        owner: {
          select: {
            id: true,
            email: true,
            name: true,
            avatar: true,
          },
        },
      },
    });

    // Start sync interval for this document
    this.startDocumentSync(document.id);
    
    return document;
  }

  async findById(id: string, userId: string) {
    // First check access using collaboration service
    const { hasAccess, role } = await collaborationService.checkAccess(id, userId);
    
    if (!hasAccess) {
      return null;
    }
    
    const document = await prisma.document.findUnique({
      where: { id },
      include: {
        owner: {
          select: {
            id: true,
            email: true,
            name: true,
            avatar: true,
          },
        },
        collaborators: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true,
                avatar: true,
              },
            },
          },
        },
      },
    });

    if (!document) return null;

    return {
      ...document,
      userRole: role,
      collaborators: document.collaborators.map(c => ({
        ...c.user,
        role: c.role,
      })),
    };
  }

  async findByUserId(userId: string) {
    return await prisma.document.findMany({
      where: {
        ownerId: userId,
      },
      include: {
        owner: {
          select: {
            id: true,
            email: true,
            name: true,
            avatar: true,
          },
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
    });
  }

  async update(id: string, userId: string, documentData: UpdateDocument) {
    return await prisma.document.update({
      where: {
        id,
        ownerId: userId,
      },
      data: documentData,
      include: {
        owner: {
          select: {
            id: true,
            email: true,
            name: true,
            avatar: true,
          },
        },
      },
    });
  }

  async delete(id: string, userId: string) {
    // Stop sync interval and cleanup caches
    this.stopDocumentSync(id);
    this.yjsDocumentCache.delete(id);
    this.pendingUpdates.delete(id);
    this.updateCount.delete(id);
    
    return await prisma.document.delete({
      where: {
        id,
        ownerId: userId,
      },
    });
  }

  async getYjsDocument(documentId: string): Promise<Doc> {
    // Check in-memory cache first (fastest)
    const memCached = this.yjsDocumentCache.get(documentId);
    if (memCached) {
      memCached.lastAccess = Date.now();
      return memCached.doc;
    }
    
    // Try Redis cache second
    const cachedState = await RedisService.getCachedDocumentState(documentId);
    
    if (cachedState) {
      const yjsDoc = new Doc();
      const update = Buffer.from(cachedState, 'base64');
      applyUpdate(yjsDoc, update);
      
      // Store in memory cache
      this.yjsDocumentCache.set(documentId, { doc: yjsDoc, lastAccess: Date.now() });
      return yjsDoc;
    }

    // Get from database (slowest)
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      select: { content: true },
    });

    if (!document) {
      throw new Error('Document not found');
    }

    const yjsDoc = new Doc();
    if (document.content) {
      const update = Buffer.from(document.content, 'base64');
      applyUpdate(yjsDoc, update);
    }

    // Cache in Redis and memory
    await RedisService.cacheDocumentState(documentId, document.content);
    this.yjsDocumentCache.set(documentId, { doc: yjsDoc, lastAccess: Date.now() });
    
    return yjsDoc;
  }

  async applyYjsUpdate(documentId: string, update: Uint8Array): Promise<void> {
    const yjsDoc = await this.getYjsDocument(documentId);
    applyUpdate(yjsDoc, update);
    
    // Update memory cache
    this.yjsDocumentCache.set(documentId, { doc: yjsDoc, lastAccess: Date.now() });
    
    // Cache the updated state in Redis
    const newState = Buffer.from(encodeStateAsUpdate(yjsDoc)).toString('base64');
    await RedisService.cacheDocumentState(documentId, newState);
    
    // Track update count for batch writes
    const currentCount = (this.updateCount.get(documentId) || 0) + 1;
    this.updateCount.set(documentId, currentCount);
    
    // Store pending update
    this.pendingUpdates.set(documentId, {
      documentId,
      state: newState,
      timestamp: Date.now(),
    });
    
    // Force sync if we've accumulated too many updates (prevents data loss)
    if (currentCount >= BATCH_WRITE_THRESHOLD) {
      await this.syncDocumentToDatabase(documentId);
    }
  }
  
  private async syncDocumentToDatabase(documentId: string): Promise<void> {
    const pendingUpdate = this.pendingUpdates.get(documentId);
    if (!pendingUpdate) return;
    
    try {
      await prisma.document.update({
        where: { id: documentId },
        data: { 
          content: pendingUpdate.state,
          updatedAt: new Date(),
        },
      });
      
      // Clear tracking after successful sync
      this.pendingUpdates.delete(documentId);
      this.updateCount.set(documentId, 0);
      
      logger.debug(`Synced document ${documentId} to database`);
    } catch (error) {
      logger.error(`Failed to sync document ${documentId}:`, error);
      // Don't clear pending update on failure - will retry on next interval
    }
  }
  
  // Batch sync multiple documents at once for efficiency
  async batchSyncDocuments(): Promise<{ synced: number; failed: number }> {
    const documentIds = Array.from(this.pendingUpdates.keys());
    let synced = 0;
    let failed = 0;
    
    // Use transaction for batch updates
    try {
      await withTransaction(async (tx) => {
        for (const documentId of documentIds) {
          const pendingUpdate = this.pendingUpdates.get(documentId);
          if (pendingUpdate) {
            await tx.document.update({
              where: { id: documentId },
              data: { 
                content: pendingUpdate.state,
                updatedAt: new Date(),
              },
            });
            this.pendingUpdates.delete(documentId);
            this.updateCount.set(documentId, 0);
            synced++;
          }
        }
      });
    } catch (error) {
      logger.error('Batch sync failed:', error);
      failed = documentIds.length - synced;
    }
    
    return { synced, failed };
  }

  private startDocumentSync(documentId: string): void {
    // Prevent duplicate intervals
    if (this.documentSyncInterval.has(documentId)) {
      return;
    }
    
    // Sync document state to database at regular intervals
    const interval = setInterval(async () => {
      await this.syncDocumentToDatabase(documentId);
    }, SYNC_INTERVAL_MS);

    this.documentSyncInterval.set(documentId, interval);
  }

  private stopDocumentSync(documentId: string): void {
    const interval = this.documentSyncInterval.get(documentId);
    if (interval) {
      clearInterval(interval);
      this.documentSyncInterval.delete(documentId);
    }
  }
  
  // Force sync a document immediately (useful before disconnect)
  async forceSyncDocument(documentId: string): Promise<void> {
    await this.syncDocumentToDatabase(documentId);
  }
  
  // Get stats for monitoring
  getStats(): {
    cachedDocuments: number;
    pendingUpdates: number;
    activeSyncIntervals: number;
  } {
    return {
      cachedDocuments: this.yjsDocumentCache.size,
      pendingUpdates: this.pendingUpdates.size,
      activeSyncIntervals: this.documentSyncInterval.size,
    };
  }

  // Cleanup method to stop all sync intervals and flush pending updates
  async cleanup(): Promise<void> {
    // Flush all pending updates before shutdown
    logger.info('Flushing pending document updates...');
    const { synced, failed } = await this.batchSyncDocuments();
    logger.info(`Flushed ${synced} documents, ${failed} failed`);
    
    // Clear all intervals
    for (const [documentId, interval] of this.documentSyncInterval) {
      clearInterval(interval);
    }
    this.documentSyncInterval.clear();
    
    // Clear caches
    this.yjsDocumentCache.clear();
    this.pendingUpdates.clear();
    this.updateCount.clear();
    
    // Stop cache cleanup
    if (this.cacheCleanupInterval) {
      clearInterval(this.cacheCleanupInterval);
      this.cacheCleanupInterval = null;
    }
  }
}

export const documentService = new DocumentService();

// Cleanup on process exit
process.on('SIGTERM', async () => {
  await documentService.cleanup();
});

process.on('SIGINT', async () => {
  await documentService.cleanup();
});