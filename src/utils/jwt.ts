import jwt from 'jsonwebtoken';
import { config } from '../config/config';
import { JWTPayload } from '../models/types';

const convertExpiresInToSeconds = (expiresIn: string): number => {
  const value = parseInt(expiresIn.slice(0, -1), 10);
  const unit = expiresIn.slice(-1);

  switch (unit) {
    case 's':
      return value;
    case 'm':
      return value * 60;
    case 'h':
      return value * 60 * 60;
    case 'd':
      return value * 60 * 60 * 24;
    default:
      throw new Error(`Unsupported time unit: ${unit}`);
  }
};

export class JWTUtils {
  static generateAccessToken(payload: Omit<JWTPayload, 'iat' | 'exp'>): string {
    return jwt.sign(payload, config.jwtSecret, {
      expiresIn: convertExpiresInToSeconds(config.jwtExpiresIn),
    });
  }

  static generateRefreshToken(payload: { userId: string }): string {
    return jwt.sign(payload, config.jwtRefreshSecret, {
      expiresIn: convertExpiresInToSeconds(config.jwtRefreshExpiresIn),
    });
  }

  static verifyAccessToken(token: string): JWTPayload {
    return jwt.verify(token, config.jwtSecret) as JWTPayload;
  }

  static verifyRefreshToken(token: string): { userId: string } {
    return jwt.verify(token, config.jwtRefreshSecret) as { userId: string };
  }

  static decodeToken(token: string): JWTPayload | null {
    try {
      return jwt.decode(token) as JWTPayload;
    } catch {
      return null;
    }
  }

  static getTokenExpiration(token: string): number | null {
    const decoded = this.decodeToken(token);
    return decoded?.exp || null;
  }
}