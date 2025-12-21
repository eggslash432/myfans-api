// api/src/apps/shops/shop-auth.service.ts
import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { ShopMemberRole } from '@prisma/client';

@Injectable()
export class ShopAuthService {
  constructor(private readonly prisma: PrismaService) {}

  requireUserId(req: Request): string {
    const userId = String((req as any).user?.id ?? '');
    if (!userId) throw new UnauthorizedException('ログイン情報が取得できません');
    return userId;
  }

  /**
   * ✅ 自分が所属する shopMember を取得（shopId特定 + 権限チェック）
   */
  async getMyShopMemberOrThrow(
    req: Request,
    roles?: ShopMemberRole[],
  ): Promise<{ userId: string; shopId: string; role: ShopMemberRole }> {
    const userId = this.requireUserId(req);

    const member = await this.prisma.shopMember.findFirst({
      where: { userId },
      select: { shopId: true, role: true },
    });

    if (!member?.shopId) throw new ForbiddenException('Shop に所属していません');

    if (roles && roles.length > 0 && !roles.includes(member.role)) {
      throw new ForbiddenException('Shop 管理権限がありません');
    }

    return { userId, shopId: member.shopId, role: member.role };
  }

  /**
   * ✅ 互換URL用（/shops/:shopId/...）の安全弁
   * - 自分の所属shopと一致してるか強制
   * - roles 指定があれば role もチェック
   */
  async assertMyShopIdMatchesOrThrow(
    req: Request,
    shopId: string,
    roles?: ShopMemberRole[],
  ) {
    const me = await this.getMyShopMemberOrThrow(req, roles);
    if (me.shopId !== shopId) throw new ForbiddenException('他のShopにはアクセスできません');
    return me;
  }
}
