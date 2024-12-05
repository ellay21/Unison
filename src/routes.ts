import { Router } from 'express';
import passport from 'passport';
import { AuthController } from './controllers/authController';
import { DocumentController } from './controllers/documentController';
import { CollaborationController } from './controllers/collaborationController';
import { authenticateToken } from './middleware/auth';
import { validateBody, validateParams } from './middleware/validation';
import { 
  CreateDocumentSchema, 
  UpdateDocumentSchema, 
  LoginSchema, 
  RefreshTokenSchema,
  RegisterSchema 
} from './models/types';
import { z } from 'zod';

const router = Router();

// Auth routes
router.post('/auth/login', validateBody(LoginSchema), AuthController.login);
router.post('/auth/register', validateBody(RegisterSchema), AuthController.register);
router.post('/auth/refresh', validateBody(RefreshTokenSchema), AuthController.refresh);
router.post('/auth/logout', AuthController.logout);

// OAuth routes (stubs)
router.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
router.get('/auth/google/callback', passport.authenticate('google'), AuthController.googleCallback);
router.get('/auth/github', passport.authenticate('github', { scope: ['user:email'] }));
router.get('/auth/github/callback', passport.authenticate('github'), AuthController.githubCallback);

// Document routes
router.post('/documents', authenticateToken, validateBody(CreateDocumentSchema), DocumentController.create);
router.get('/documents', authenticateToken, DocumentController.list);
router.get('/documents/all', authenticateToken, CollaborationController.getAllDocuments); // Get owned + shared
router.get('/documents/:id', authenticateToken, validateParams(z.object({ id: z.string().uuid() })), DocumentController.getById);
router.put('/documents/:id', authenticateToken, validateParams(z.object({ id: z.string().uuid() })), validateBody(UpdateDocumentSchema), DocumentController.update);
router.delete('/documents/:id', authenticateToken, validateParams(z.object({ id: z.string().uuid() })), DocumentController.delete);

// Collaboration routes
router.get('/documents/:id/collaborators', authenticateToken, CollaborationController.getCollaborators);
router.post('/documents/:id/collaborators', authenticateToken, CollaborationController.addCollaborator);
router.put('/documents/:id/collaborators/:userId', authenticateToken, CollaborationController.updateCollaborator);
router.delete('/documents/:id/collaborators/:userId', authenticateToken, CollaborationController.removeCollaborator);
router.put('/documents/:id/visibility', authenticateToken, CollaborationController.setPublic);

export default router;