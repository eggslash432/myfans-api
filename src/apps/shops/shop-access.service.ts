// api/src/apps/shop/shop-access.service.ts
import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ShopMemberRole } from '@prisma/client';

@Injectable()
export class ShopAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async getMyShopRoleOrThrow(userId: string) {
    const member = await this.prisma.shopMember.findFirst({
      where: { userId },
      select: { shopId: true, role: true },
    });
    if (!member) throw new ForbiddenException('店舗メンバーではありません');
    return member; // {shopId, role}
  }

  assertCanRequestPayout(role: ShopMemberRole) {
    if (role !== 'owner' && role !== 'admin') {
      throw new ForbiddenException('振込申請の権限がありません');
    }
  }
}
