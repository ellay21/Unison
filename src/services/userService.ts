import { PrismaClient } from '@prisma/client';
import { CreateUser, UpdateUser } from '../models/types';
import bcrypt from 'bcryptjs';


const prisma = new PrismaClient();

export class UserService {
  async findById(id: string) {
    return await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        provider: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async findByEmail(email: string) {
    return await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        provider: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async create(userData: CreateUser) {
    return await prisma.user.create({
      data: userData,
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        provider: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async update(id: string, userData: UpdateUser) {
    return await prisma.user.update({
      where: { id },
      data: userData,
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        provider: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async findOrCreateOAuthUser(userData: CreateUser) {
    const existingUser = await this.findByEmail(userData.email);
    
    if (existingUser) {
      return await this.update(existingUser.id, {
        name: userData.name,
        avatar: userData.avatar,
      });
    }
    
    return await this.create(userData);
  }

  async delete(id: string) {
    return await prisma.user.delete({
      where: { id },
    });
  }

  async createWithPassword(userData: CreateUser & { password?: string }) {
    const hashedPassword = userData.password ? await bcrypt.hash(userData.password, 12) : null;
    
    return await prisma.user.create({
      data: {
        ...userData,
        password: hashedPassword,
      },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        provider: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async verifyPassword(email: string, password: string): Promise<any | null> {
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        provider: true,
        password: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user || !user.password) {
      return null;
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return null;
    }

    // Remove password from returned user object
    const { password: _, ...userWithoutPassword } = user;
    return userWithoutPassword;
  }
}

export const userService = new UserService();
