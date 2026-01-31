// api/src/shared/guards/shop-license-approved.guard.ts

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../apps/prisma/prisma.service';

type JwtUserLike = {
  id: string;
  shopId?: string | null;
  role?: string; // あるなら使う
};

@Injectable()
export class ShopLicenseApprovedGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const user = req.user as JwtUserLike | undefined;

    if (!user) throw new UnauthorizedException('ログインが必要です');

    // shopIdがないユーザーは対象外（= 店舗機能にアクセスできない想定）
    const shopId = user.shopId;
    if (!shopId) {
      throw new ForbiddenException('店舗アカウントではありません');
    }

    const shop = await this.prisma.shop.findUnique({
      where: { id: shopId },
      select: { businessLicenseStatus: true },
    });

    if (!shop) throw new ForbiddenException('店舗が見つかりません');

    if (shop.businessLicenseStatus !== ('approved' as any)) {
      // ここはフロントで案内ページへ誘導できるようメッセージを明確化
      throw new ForbiddenException('営業許可書の確認が完了していません');
    }

    return true;
  }
}
