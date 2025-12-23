// api/src/apps/users/users.service.ts
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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

  async changePassword(userId: string, current: string, next: string) {
    // ✅ ここが重要：bcryptに渡す前に必須チェック
    if (!current || !next) {
      throw new BadRequestException(
        'currentPassword と newPassword を送ってください',
      );
    }
    if (next.length < 8) {
      throw new BadRequestException('新しいパスワードは8文字以上にしてください');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, passwordHash: true }, // ✅ 明示（安全）
    });

    if (!user) throw new NotFoundException('User not found');
    if (!user.passwordHash) {
      throw new BadRequestException('パスワード未設定のユーザーです');
    }

    const ok = await bcrypt.compare(current, user.passwordHash);
    if (!ok) throw new ForbiddenException('Current password invalid');

    const hash = await bcrypt.hash(next, 10);

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: hash },
    });

    return { ok: true };
  }
}
