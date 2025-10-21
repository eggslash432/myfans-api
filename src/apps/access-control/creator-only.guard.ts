import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * @CreatorOnly
 * JWT認証済みで、かつUser.roleが 'creator' の場合のみ許可。
 */
@Injectable()
export class CreatorOnlyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const user = req.user;

    if (!user) {
      throw new ForbiddenException('ログインが必要です');
    }

    // 1️⃣ DBからユーザーを取得してrole確認
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.sub },
      select: { role: true },
    });

    if (!dbUser) throw new ForbiddenException('ユーザーが存在しません');

    if (dbUser.role !== 'creator') {
      throw new ForbiddenException('クリエイターのみ実行可能です');
    }

    return true;
  }
}
