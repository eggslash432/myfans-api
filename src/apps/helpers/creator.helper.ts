// src/apps/helpers/creator.helper.ts
import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CreatorHelper {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * ログインユーザーが Creator かどうか確認し、CreatorId を返す
   */
  async getMyCreatorId(userId: string): Promise<string> {
    const c = await this.prisma.creator.findUnique({
      where: { userId: String(userId) },
      select: { userId: true },
    });

    if (!c) throw new ForbiddenException('Creator only');

    return c.userId;
  }
}
