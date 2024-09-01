import { User as PrismaUser } from '@prisma/client';
import { CreateUser, UpdateUser } from '../models/types';
import bcrypt from 'bcryptjs';
import { prisma } from './prisma';

export class UserService {
  async findById(id: string): Promise<PrismaUser | null> {
    return await prisma.user.findUnique({
      where: { id },
    });
  }

  async findByEmail(email: string): Promise<PrismaUser | null> {
    return await prisma.user.findUnique({
      where: { email },
    });
  }

  async create(userData: CreateUser): Promise<PrismaUser> {
    return await prisma.user.create({
      data: userData,
    });
  }

  async update(id: string, userData: UpdateUser): Promise<PrismaUser> {
    return await prisma.user.update({
      where: { id },
      data: userData,
    });
  }

  async findOrCreateOAuthUser(userData: any): Promise<PrismaUser> {
    const existingUser = await prisma.user.findFirst({
      where: {
        providerId: userData.providerId,
        provider: userData.provider,
      },
    });

    if (existingUser) {
      return await this.update(existingUser.id, {
        name: userData.name,
        avatar: userData.avatar,
      });
    }

    const newUser = await prisma.user.create({
      data: {
        ...userData,
        password: null, // OAuth users don't have a password
      },
    });
    return newUser;
  }

  async delete(id: string): Promise<PrismaUser> {
    return await prisma.user.delete({
      where: { id },
    });
  }

  async createWithPassword(userData: CreateUser & { password?: string }): Promise<PrismaUser> {
    const hashedPassword = userData.password ? await bcrypt.hash(userData.password, 12) : null;
    return await prisma.user.create({
      data: {
        ...userData,
        password: hashedPassword,
      },
    });
  }

  async verifyPassword(email: string, password: string): Promise<Omit<PrismaUser, 'password'> | null> {
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user || !user.password) {
      return null;
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return null;
    }

    const { password: _, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }
}

export const userService = new UserService();