import { prisma } from './prisma';
import { logger } from '../utils/logger';
import { Document, DocumentCollaborator, User } from '@prisma/client';

export type CollaboratorRole = 'viewer' | 'editor' | 'admin';

type CollaboratorWithUser = DocumentCollaborator & {
  user: Pick<User, 'id' | 'email' | 'name' | 'avatar'>;
};

type DocumentWithOwnerAndCount = Document & {
  owner: Pick<User, 'id' | 'email' | 'name' | 'avatar'>;
  _count: { collaborators: number };
};

type CollaboratorWithDocument = DocumentCollaborator & {
  document: DocumentWithOwnerAndCount;
};

interface AddCollaboratorInput {
  documentId: string;
  userId: string;
  role?: CollaboratorRole;
}

interface CollaboratorInfo {
  userId: string;
  email: string;
  name: string | null;
  avatar: string | null;
  role: string;
}

export class CollaborationService {
  async checkAccess(documentId: string, userId: string): Promise<{ hasAccess: boolean; role: string | null }> {
    const document = await prisma.document.findFirst({
      where: { id: documentId },
      select: { ownerId: true, isPublic: true },
    });

    if (!document) {
      return { hasAccess: false, role: null };
    }

    if (document.ownerId === userId) {
      return { hasAccess: true, role: 'owner' };
    }

    if (document.isPublic) {
      return { hasAccess: true, role: 'viewer' };
    }

    const collaborator = await prisma.documentCollaborator.findUnique({
      where: {
        documentId_userId: { documentId, userId },
      },
    });

    if (collaborator) {
      return { hasAccess: true, role: collaborator.role };
    }

    return { hasAccess: false, role: null };
  }
  async canEdit(documentId: string, userId: string): Promise<boolean> {
    const { hasAccess, role } = await this.checkAccess(documentId, userId);
    return hasAccess && role !== 'viewer';
  }

  //Add a collaborator to a document
   
  async addCollaborator(
    documentId: string, 
    ownerId: string, 
    input: AddCollaboratorInput
  ): Promise<CollaboratorInfo | null> {
    const document = await prisma.document.findFirst({
      where: { id: documentId, ownerId },
    });

    if (!document) {
      logger.warn('Unauthorized attempt to add collaborator', { documentId, ownerId });
      return null;
    }

    // Can't add owner as collaborator
    if (input.userId === ownerId) {
      return null;
    }

    const user = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true, email: true, name: true, avatar: true },
    });

    if (!user) {
      return null;
    }

    const collaborator = await prisma.documentCollaborator.upsert({
      where: {
        documentId_userId: { documentId, userId: input.userId },
      },
      create: {
        documentId,
        userId: input.userId,
        role: input.role || 'editor',
      },
      update: {
        role: input.role || 'editor',
      },
    });

    logger.info('Collaborator added', { documentId, userId: input.userId, role: collaborator.role });

    return {
      userId: user.id,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      role: collaborator.role,
    };
  }

  //Add collaborator by email
  async addCollaboratorByEmail(
    documentId: string,
    ownerId: string,
    email: string,
    role: CollaboratorRole = 'editor'
  ): Promise<CollaboratorInfo | null> {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (!user) {
      logger.warn('User not found for collaboration invite', { email });
      return null;
    }

    return this.addCollaborator(documentId, ownerId, { 
      documentId, 
      userId: user.id, 
      role 
    });
  }

  //Remove a collaborator from a document
  async removeCollaborator(
    documentId: string, 
    ownerId: string, 
    userId: string
  ): Promise<boolean> {
    // Verify ownership
    const document = await prisma.document.findFirst({
      where: { id: documentId, ownerId },
    });

    if (!document) {
      return false;
    }

    try {
      await prisma.documentCollaborator.delete({
        where: {
          documentId_userId: { documentId, userId },
        },
      });

      logger.info('Collaborator removed', { documentId, userId });
      return true;
    } catch (error) {
      logger.error('Failed to remove collaborator', error);
      return false;
    }
  }

  //Get all collaborators for a document
  async getCollaborators(documentId: string): Promise<CollaboratorInfo[]> {
    const collaborators = await prisma.documentCollaborator.findMany({
      where: { documentId },
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
    });

    return collaborators.map((c: CollaboratorWithUser) => ({
      userId: c.user.id,
      email: c.user.email,
      name: c.user.name,
      avatar: c.user.avatar,
      role: c.role,
    }));
  }

  //Get all documents a user has access to (owned + shared)
  async getUserDocuments(userId: string) {
    const [owned, shared] = await Promise.all([
      prisma.document.findMany({
        where: { ownerId: userId },
        include: {
          owner: {
            select: { id: true, email: true, name: true, avatar: true },
          },
          _count: {
            select: { collaborators: true },
          },
        },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.documentCollaborator.findMany({
        where: { userId },
        include: {
          document: {
            include: {
              owner: {
                select: { id: true, email: true, name: true, avatar: true },
              },
              _count: {
                select: { collaborators: true },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      owned: owned.map((doc: DocumentWithOwnerAndCount) => ({
        ...doc,
        role: 'owner' as const,
        collaboratorCount: doc._count.collaborators,
      })),
      shared: shared.map((collab: CollaboratorWithDocument) => ({
        ...collab.document,
        role: collab.role as CollaboratorRole,
        collaboratorCount: collab.document._count.collaborators,
      })),
    };
  }

  //Update document visibility
  async setPublic(documentId: string, ownerId: string, isPublic: boolean): Promise<boolean> {
    try {
      await prisma.document.update({
        where: { id: documentId, ownerId },
        data: { isPublic },
      });

      logger.info('Document visibility updated', { documentId, isPublic });
      return true;
    } catch (error) {
      logger.error('Failed to update document visibility', error);
      return false;
    }
  }

  //Update collaborator role
  async updateCollaboratorRole(
    documentId: string,
    ownerId: string,
    userId: string,
    role: CollaboratorRole
  ): Promise<boolean> {
    const document = await prisma.document.findFirst({
      where: { id: documentId, ownerId },
    });

    if (!document) {
      return false;
    }

    try {
      await prisma.documentCollaborator.update({
        where: {
          documentId_userId: { documentId, userId },
        },
        data: { role },
      });

      logger.info('Collaborator role updated', { documentId, userId, role });
      return true;
    } catch (error) {
      logger.error('Failed to update collaborator role', error);
      return false;
    }
  }
}

export const collaborationService = new CollaborationService();
