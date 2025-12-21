// api/src/apps/access-control/creator-only.guard.ts
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatorApprovalStatus } from '@prisma/client';
import { RequestWithUser } from 'src/shared/types';

@Injectable()
export class CreatorOnlyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    if (!user?.id) {
      throw new UnauthorizedException('ログインが必要です');
    }

    const creator = await this.prisma.creator.findUnique({
      where: { userId: user.id },
      select: { approvalStatus: true },
    });

    if (!creator) {
      throw new ForbiddenException('クリエイター申請が必要です');
    }

    if (creator.approvalStatus !== CreatorApprovalStatus.approved) {
      throw new ForbiddenException('承認済みクリエイターのみ利用可能です');
    }

    return true;
  }
}

