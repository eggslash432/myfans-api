// api/src/apps/access-control/shop-owner-or-admin.guard.ts
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

@Injectable()
export class ShopOwnerOrAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const user = req.user;

    const shopId = user?.shopId as string | undefined;
    if (!shopId) {
      throw new ForbiddenException('shop context not found');
    }

    // ✅ ここが環境依存：JWTに載ってるキーに合わせる
    const role =
      (user?.shopRole ??
        user?.shopMemberRole ??
        user?.role) as string | undefined;

    // owner / admin を許可
    if (role === 'owner' || role === 'admin' || role === 'shop_owner' || role === 'shop_admin') {
      return true;
    }

    throw new ForbiddenException('insufficient shop permission');
  }
}
