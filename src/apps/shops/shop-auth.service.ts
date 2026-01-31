// api/src/apps/shops/shop-auth.service.ts
import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { ShopMemberRole, Role } from '@prisma/client';

@Injectable()
export class ShopAuthService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * ✅ JWTから userId を安全に取り出す
   * - guard実装差分で payload のキーが揺れがちなので吸収する
   */
  requireUserId(req: Request): string {
    const u = (req as any).user ?? {};

    // よくある候補：id / userId / sub
    const raw = u.id ?? u.userId ?? u.sub;

    const userId = typeof raw === 'string' ? raw : String(raw ?? '');

    // "undefined" / "null" など文字列化事故も弾く
    if (!userId || userId === 'undefined' || userId === 'null') {
      throw new UnauthorizedException('ログイン情報が取得できません');
    }
    return userId;
  }

  /**
   * ✅ 運営管理者（platform admin）かどうか
   * - JWT に role が入ってるならそれを優先
   * - 無ければ DB の user.role を見に行く
   */
  async assertPlatformAdminOrThrow(req: Request): Promise<{ userId: string }> {
    const userId = this.requireUserId(req);

    const u = (req as any).user ?? {};
    const jwtRole = (u.role ?? u.userRole) as Role | string | undefined;

    if (jwtRole === 'admin') return { userId };

    const dbUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    if (dbUser?.role !== Role.admin) {
      throw new ForbiddenException('運営管理者のみ実行できます');
    }

    return { userId };
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
   */
  async assertMyShopIdMatchesOrThrow(
    req: Request,
    shopId: string,
    roles?: ShopMemberRole[],
  ) {
    const me = await this.getMyShopMemberOrThrow(req, roles);
    if (me.shopId !== shopId) {
      throw new ForbiddenException('他のShopにはアクセスできません');
    }
    return me;
  }
}
