import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role, User } from '@prisma/client';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  create(email: string, passwordHash: string, role: Role): Promise<User> {
    return this.prisma.user.create({
      data: { email, passwordHash, role },
    });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async findMe(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true,
        profile: {
          select: {
            displayName: true,
            avatarUrl: true,
          },
        },
      },
    });
  }

  async updateMe(userId: string, data: any) {
    return this.prisma.user.update({
      where: { id: userId },
      data,
    });
  }  

  async changePassword(
    userId: string,
    current: string,
    next: string,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) throw new Error('User not found');

    const ok = await bcrypt.compare(current, user.passwordHash);
    if (!ok) throw new Error('Current password invalid');

    const hash = await bcrypt.hash(next, 10);

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: hash },
    });

    return { ok: true };
  }  
}
