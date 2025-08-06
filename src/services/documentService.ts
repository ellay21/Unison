import { PrismaClient } from '@prisma/client';
import { Doc, encodeStateAsUpdate, applyUpdate } from 'yjs'; 
import { CreateDocument, UpdateDocument } from '../models/types';
import { RedisService } from './redis';
import { logger } from '../utils/logger';

const prisma = new PrismaClient();

export class DocumentService {
  private documentSyncInterval: Map<string, NodeJS.Timeout> = new Map();

  async create(userId: string, documentData: CreateDocument) {
    // Create new Yjs document
    const yjsDoc = new Doc();
    const text = yjsDoc.getText('content');
    text.insert(0, documentData.content || '');
    
    // Correctly call encodeStateAsUpdate as a function
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
    const document = await prisma.document.findFirst({
      where: {
        id,
        ownerId: userId, // Only owner can access for now
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

    return document;
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
    // Stop sync interval
    this.stopDocumentSync(id);
    
    return await prisma.document.delete({
      where: {
        id,
        ownerId: userId,
      },
    });
  }

  async getYjsDocument(documentId: string): Promise<Doc> {
    // Try to get from cache first
    const cachedState = await RedisService.getCachedDocumentState(documentId);
    
    if (cachedState) {
      const yjsDoc = new Doc();
      const update = Buffer.from(cachedState, 'base64');
      applyUpdate(yjsDoc, update);
      return yjsDoc;
    }

    // Get from database
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

    // Cache the state
    await RedisService.cacheDocumentState(documentId, document.content);
    
    return yjsDoc;
  }

  async applyYjsUpdate(documentId: string, update: Uint8Array): Promise<void> {
    const yjsDoc = await this.getYjsDocument(documentId);
    applyUpdate(yjsDoc, update);
    
    // Cache the updated state
    const newState = Buffer.from(encodeStateAsUpdate(yjsDoc)).toString('base64'); 
    await RedisService.cacheDocumentState(documentId, newState);
  }

  private startDocumentSync(documentId: string): void {
    // Sync document state to database every 5 seconds
    const interval = setInterval(async () => {
      try {
        const cachedState = await RedisService.getCachedDocumentState(documentId);
        if (cachedState) {
          await prisma.document.update({
            where: { id: documentId },
            data: { 
              content: cachedState,
              updatedAt: new Date(),
            },
          });
          logger.info(`Synced document ${documentId} to database`);
        }
      } catch (error) {
        logger.error(`Failed to sync document ${documentId}:`, error);
      }
    }, 5000);

    this.documentSyncInterval.set(documentId, interval);
  }

  private stopDocumentSync(documentId: string): void {
    const interval = this.documentSyncInterval.get(documentId);
    if (interval) {
      clearInterval(interval);
      this.documentSyncInterval.delete(documentId);
    }
  }

  // Cleanup method to stop all sync intervals
  cleanup(): void {
    for (const [documentId, interval] of this.documentSyncInterval) {
      clearInterval(interval);
    }
    this.documentSyncInterval.clear();
  }
}

export const documentService = new DocumentService();

// Cleanup on process exit
process.on('SIGTERM', () => {
  documentService.cleanup();
});

process.on('SIGINT', () => {
  documentService.cleanup();
});