// api/src/apps/creators/controllers/creators.controller-helpers.ts

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CreatorsControllerHelpers {
  constructor(private readonly prisma: PrismaService) {}

  getUserIdOrThrow(req: any): string {
    const userId = String(req?.user?.id ?? '');
    if (!userId) throw new UnauthorizedException('JWTが無効です');
    return userId;
  }

  /** クリエイター登録は必要、approved必須かどうかは呼び出し側で選択 */
  async getCreatorByUserId(userId: string) {
    return this.prisma.creator.findUnique({
      where: { userId },
      select: { userId: true, approvalStatus: true },
    });
  }

  async requireCreatorApproved(userId: string) {
    const creator = await this.getCreatorByUserId(userId);
    if (!creator) throw new ForbiddenException('クリエイター登録が必要です');
    if (creator.approvalStatus !== 'approved') {
      throw new ForbiddenException('承認済みクリエイターのみ実行できます');
    }
    return creator; // { userId, approvalStatus }
  }

  /** Queryのlimit等 */
  parseLimit(limitRaw: any, def = 20, min = 1, max = 100) {
    const n = Number(limitRaw);
    if (!Number.isFinite(n)) return def;
    return Math.min(Math.max(Math.trunc(n), min), max);
  }
}
