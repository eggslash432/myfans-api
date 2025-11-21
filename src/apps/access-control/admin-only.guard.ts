// src/apps/access-control/admin-only.guard.ts
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

@Injectable()
export class AdminOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();

    // JWTデコード後のユーザー
    const user = req.user;

    if (!user) {
      throw new ForbiddenException('ログインが必要です');
    }

    if (user.role !== 'admin') {
      throw new ForbiddenException('管理者のみアクセスできます');
    }

    return true;
  }
}
