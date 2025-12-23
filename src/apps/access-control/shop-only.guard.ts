// api/src/apps/access-control/shop-only.guard.ts

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

@Injectable()
export class ShopOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const user = req.user;

    if (!user) {
      throw new ForbiddenException('Unauthenticated');
    }

    // shop コンテキストを持っているか
    if (!user.shopId) {
      throw new ForbiddenException('Shop access only');
    }

    return true;
  }
}
