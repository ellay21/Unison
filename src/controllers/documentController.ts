import { Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../middleware/auth';
import { documentService } from '../services/documentService';
import { CreateDocumentSchema, UpdateDocumentSchema } from '../models/types';

const ParamsSchema = z.object({
  id: z.string().uuid(),
});

export class DocumentController {
  static async create(req: AuthRequest, res: Response) {
    try {
      const documentData = CreateDocumentSchema.parse(req.body);
      const document = await documentService.create(req.user!.id, documentData);
      
      res.status(201).json(document);
    } catch (error) {
      res.status(500).json({ error: 'Failed to create document' });
    }
  }

  static async getById(req: AuthRequest, res: Response) {
    try {
      const { id } = ParamsSchema.parse(req.params);
      const document = await documentService.findById(id, req.user!.id);
      
      if (!document) {
        return res.status(404).json({ error: 'Document not found' });
      }
      
      res.json(document);
    } catch (error: any) {
      console.error('Get document error:', error);
      res.status(500).json({ error: 'Failed to get document', details: error.message });
    }
  }

  static async list(req: AuthRequest, res: Response) {
    try {
      const documents = await documentService.findByUserId(req.user!.id);
      res.json(documents);
    } catch (error) {
      res.status(500).json({ error: 'Failed to list documents' });
    }
  }

  static async update(req: AuthRequest, res: Response) {
    try {
      const { id } = ParamsSchema.parse(req.params);
      const documentData = UpdateDocumentSchema.parse(req.body);
      
      const document = await documentService.update(id, req.user!.id, documentData);
      res.json(document);
    } catch (error) {
      res.status(500).json({ error: 'Failed to update document' });
    }
  }

  static async delete(req: AuthRequest, res: Response) {
    try {
      const { id } = ParamsSchema.parse(req.params);
      await documentService.delete(id, req.user!.id);
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete document' });
    }
  }
}
