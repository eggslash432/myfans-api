// api/src/apps/access-control/creator-only.guard.ts
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';
import { RequestWithUser } from 'src/shared/types';

@Injectable()
export class CreatorOnlyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // ★ getRequest<RequestWithUser>() にする
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('ログインが必要です');
    }

    // DBからユーザーを取得してrole確認
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { role: true },
    });

    if (!dbUser || dbUser.role !== Role.creator) {
      throw new ForbiddenException('クリエイターのみ利用可能です');
    }

    return true;
  }
}
