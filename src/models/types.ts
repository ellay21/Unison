import { z } from 'zod';

// User schemas
export const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  avatar: z.string().url().optional(),
  provider: z.enum(['google', 'github', 'local']),
  providerId: z.string().optional(),
});

export const UpdateUserSchema = z.object({
  name: z.string().optional(),
  avatar: z.string().url().optional(),
});

// Document schemas
export const CreateDocumentSchema = z.object({
  title: z.string().min(1).max(255),
  content: z.string().optional(),
});

export const UpdateDocumentSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  content: z.string().optional(),
});

// Auth schemas
export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export const RefreshTokenSchema = z.object({
  refreshToken: z.string(),
});

// Registration schema
export const RegisterSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100),
  password: z.string().min(6).optional(), // Optional for OAuth users
});

// Socket schemas
export const JoinDocumentSchema = z.object({
  documentId: z.string().uuid(),
});

export const DocumentEditSchema = z.object({
  documentId: z.string().uuid(),
  update: z.string(), 
});

export const PresenceUpdateSchema = z.object({
  documentId: z.string().uuid(),
  cursor: z.object({
    x: z.number(),
    y: z.number(),
  }).optional(),
  selection: z.object({
    start: z.number(),
    end: z.number(),
  }).optional(),
});

export type CreateUser = z.infer<typeof CreateUserSchema>;
export type CreateUserWithPassword = CreateUser & { password?: string | null };
export type UpdateUser = z.infer<typeof UpdateUserSchema>;
export type CreateDocument = z.infer<typeof CreateDocumentSchema>;
export type UpdateDocument = z.infer<typeof UpdateDocumentSchema>;
export type Login = z.infer<typeof LoginSchema>;
export type RefreshToken = z.infer<typeof RefreshTokenSchema>;
export type Register = z.infer<typeof RegisterSchema>;
export type JoinDocument = z.infer<typeof JoinDocumentSchema>;
export type DocumentEdit = z.infer<typeof DocumentEditSchema>;
export type PresenceUpdate = z.infer<typeof PresenceUpdateSchema>;

export interface JWTPayload {
  userId: string;
  email: string;
  iat?: number;
  exp?: number;
}

export interface UserPresence {
  userId: string;
  name: string;
  avatar?: string;
  cursor?: { x: number; y: number };
  selection?: { start: number; end: number };
  lastSeen: number;
}