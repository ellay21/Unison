import { Request, Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../middleware/auth';
import { collaborationService, CollaboratorRole } from '../services/collaborationService';

// Validate the schemas
const AddCollaboratorSchema = z.object({
  email: z.string().email(),
  role: z.enum(['viewer', 'editor', 'admin']).optional().default('editor'),
});

const UpdateCollaboratorSchema = z.object({
  role: z.enum(['viewer', 'editor', 'admin']),
});

const SetPublicSchema = z.object({
  isPublic: z.boolean(),
});

const ParamsSchema = z.object({
  id: z.string().uuid(),
});

const CollaboratorParamsSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
});

export class CollaborationController {
   //Get all collaborators for a document

  static async getCollaborators(req: AuthRequest, res: Response) {
    try {
      const { id } = ParamsSchema.parse(req.params);
      
      const { hasAccess } = await collaborationService.checkAccess(id, req.user!.id);
      if (!hasAccess) {
        return res.status(403).json({ error: 'Access denied' });
      }
      
      const collaborators = await collaborationService.getCollaborators(id);
      res.json(collaborators);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get collaborators' });
    }
  }
  
  //Add a collaborator to a document
  static async addCollaborator(req: AuthRequest, res: Response) {
    try {
      const { id } = ParamsSchema.parse(req.params);
      const { email, role } = AddCollaboratorSchema.parse(req.body);
      
      const collaborator = await collaborationService.addCollaboratorByEmail(
        id,
        req.user!.id,
        email,
        role as CollaboratorRole
      );
      
      if (!collaborator) {
        return res.status(400).json({ 
          error: 'Failed to add collaborator. User may not exist or you may not own this document.' 
        });
      }
      
      res.status(201).json(collaborator);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid request body', details: error.errors });
      }
      res.status(500).json({ error: 'Failed to add collaborator' });
    }
  }

  //Update a collaborator's role
  static async updateCollaborator(req: AuthRequest, res: Response) {
    try {
      const { id, userId } = CollaboratorParamsSchema.parse(req.params);
      const { role } = UpdateCollaboratorSchema.parse(req.body);
      
      const success = await collaborationService.updateCollaboratorRole(
        id,
        req.user!.id,
        userId,
        role as CollaboratorRole
      );
      
      if (!success) {
        return res.status(400).json({ error: 'Failed to update collaborator role' });
      }
      
      res.json({ message: 'Collaborator role updated' });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid request', details: error.errors });
      }
      res.status(500).json({ error: 'Failed to update collaborator' });
    }
  }

  //Remove a collaborator from a document
  static async removeCollaborator(req: AuthRequest, res: Response) {
    try {
      const { id, userId } = CollaboratorParamsSchema.parse(req.params);
      
      const success = await collaborationService.removeCollaborator(id, req.user!.id, userId);
      
      if (!success) {
        return res.status(400).json({ error: 'Failed to remove collaborator' });
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: 'Failed to remove collaborator' });
    }
  }

  //Set document public/private
  static async setPublic(req: AuthRequest, res: Response) {
    try {
      const { id } = ParamsSchema.parse(req.params);
      const { isPublic } = SetPublicSchema.parse(req.body);
      
      const success = await collaborationService.setPublic(id, req.user!.id, isPublic);
      
      if (!success) {
        return res.status(400).json({ error: 'Failed to update document visibility' });
      }
      
      res.json({ message: `Document is now ${isPublic ? 'public' : 'private'}` });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid request', details: error.errors });
      }
      res.status(500).json({ error: 'Failed to update document visibility' });
    }
  }

  //Get all documents for user (owned + shared)
  static async getAllDocuments(req: AuthRequest, res: Response) {
    try {
      const documents = await collaborationService.getUserDocuments(req.user!.id);
      res.json(documents);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get documents' });
    }
  }
}
