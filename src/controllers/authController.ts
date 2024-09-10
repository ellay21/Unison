import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { config } from '../config/config';
import { RefreshTokenSchema, JWTPayload, CreateUserWithPassword } from '../models/types';
import { RedisService } from '../services/redis';
import { userService } from '../services/userService';
import { AuthRequest } from '../middleware/auth';
import { JWTUtils } from '../utils/jwt';
import { prisma } from '../services/prisma';
import { Logger } from '../utils/logger';

export class AuthController {
  // Login endpoint
  static async login(req: Request, res: Response) {
    try {
      const { email, password } = req.body;    
      if (password) {
        const user = await userService.verifyPassword(email, password);
        if (!user) {
          return res.status(401).json({ error: 'Invalid email or password' });
        }

        const accessToken = JWTUtils.generateAccessToken({ userId: user.id, email: user.email });
        const refreshToken = JWTUtils.generateRefreshToken({ userId: user.id });

        await prisma.refreshToken.create({
          data: {
            token: refreshToken,
            userId: user.id,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        });

        return res.json({
          user,
          accessToken,
          refreshToken,
        });
      }

      // Fallback for development
      if (config.nodeEnv === 'development') {
        let user = await userService.findByEmail(email);
        if (!user) {
          user = await userService.create({
            email,
            name: 'Development User',
            provider: 'local',
          } as CreateUserWithPassword); // Explicitly cast the object
        }

        // Use JWTUtils to generate tokens
        const accessToken = JWTUtils.generateAccessToken({ userId: user.id, email: user.email });
        const refreshToken = JWTUtils.generateRefreshToken({ userId: user.id });

        await prisma.refreshToken.create({
          data: {
            token: refreshToken,
            userId: user.id,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        });

        return res.json({
          user,
          accessToken,
          refreshToken,
        });
      }

      res.status(401).json({ error: 'Invalid credentials' });
    } catch (error) {
      Logger.getInstance().error('Login failed', { error });
      res.status(500).json({ error: 'Login failed' });
    }
  }

  // Register endpoint
  static async register(req: Request, res: Response) {
    try {
      const { email, name, password } = req.body;
      
      const existingUser = await userService.findByEmail(email);
      if (existingUser) {
        return res.status(409).json({ error: 'User already exists with this email' });
      }

      const hashedPassword = password ? await bcrypt.hash(password, 12) : null;
      
      const user = await userService.create({
        email,
        name,
        provider: 'local',
        password: hashedPassword,
      } as CreateUserWithPassword); // Explicitly cast the object

      const accessToken = JWTUtils.generateAccessToken({ userId: user.id, email: user.email });
      const refreshToken = JWTUtils.generateRefreshToken({ userId: user.id });

      await prisma.refreshToken.create({
        data: {
          token: refreshToken,
          userId: user.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      res.status(201).json({
        user,
        accessToken,
        refreshToken,
      });
    } catch (error) {
      Logger.getInstance().error('Registration failed', { error });
      res.status(500).json({ error: 'Registration failed' });
    }
  }

  static async refresh(req: Request, res: Response) {
    try {
      const { refreshToken } = RefreshTokenSchema.parse(req.body);

      const decoded = JWTUtils.verifyRefreshToken(refreshToken);
      
      const storedToken = await prisma.refreshToken.findUnique({
        where: { token: refreshToken },
      });

      if (!storedToken || storedToken.expiresAt < new Date()) {
        return res.status(401).json({ error: 'Invalid refresh token' });
      }

      const user = await userService.findById(decoded.userId);
      if (!user) {
        return res.status(401).json({ error: 'User not found' });
      }

      // Use JWTUtils to generate a new access token
      const accessToken = JWTUtils.generateAccessToken({ userId: user.id, email: user.email });

      res.json({
        accessToken,
        user,
      });
    } catch (error) {
      res.status(401).json({ error: 'Invalid refresh token' });
    }
  }

  static async logout(req: AuthRequest, res: Response) {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader && authHeader.split(' ')[1];

      if (token) {
        const decoded = JWTUtils.decodeToken(token);
        if (decoded && decoded.exp) { 
          const expiresIn = decoded.exp - Math.floor(Date.now() / 1000);
          
          if (expiresIn > 0) {
            await RedisService.blacklistToken(token, expiresIn);
          }
        }
      }

      const { refreshToken } = req.body;
      if (refreshToken) {
        await prisma.refreshToken.deleteMany({
          where: { token: refreshToken },
        });
      }

      res.json({ message: 'Logged out successfully' });
    } catch (error) {
      res.status(500).json({ error: 'Logout failed' });
    }
  }

  // OAuth endpoints
  static async googleCallback(req: Request, res: Response) {
    try {
      const user = req.user as any;
      
      if (!user) {
        return res.redirect(`${config.frontendUrl}/auth/error?message=oauth_failed`);
      }

      const accessToken = JWTUtils.generateAccessToken({ userId: user.id, email: user.email });
      const refreshToken = JWTUtils.generateRefreshToken({ userId: user.id });

      await prisma.refreshToken.create({
        data: {
          token: refreshToken,
          userId: user.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      res.redirect(`${config.frontendUrl}/auth/success?token=${accessToken}&refresh=${refreshToken}`);
    } catch (error) {
      res.redirect(`${config.frontendUrl}/auth/error?message=server_error`);
    }
  }

  static async githubCallback(req: Request, res: Response) {
    try {
      const user = req.user as any;
      
      if (!user) {
        return res.redirect(`${config.frontendUrl}/auth/error?message=oauth_failed`);
      }

      const accessToken = JWTUtils.generateAccessToken({ userId: user.id, email: user.email });
      const refreshToken = JWTUtils.generateRefreshToken({ userId: user.id });

      await prisma.refreshToken.create({
        data: {
          token: refreshToken,
          userId: user.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      res.redirect(`${config.frontendUrl}/auth/success?token=${accessToken}&refresh=${refreshToken}`);
    } catch (error) {
      res.redirect(`${config.frontendUrl}/auth/error?message=server_error`);
    }
  }
}