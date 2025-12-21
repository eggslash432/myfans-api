// api/src/apps/shops/shops.module.ts
import { Module } from '@nestjs/common';

// 共通サービス
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

// 今回追加した Controller
import { ShopDashboardController } from './shop-dashboard.controller';
import { ShopSelfController } from './shop-self.controller';
import { ShopSalesController } from './shop-sales.controller';
import { ShopApplicationsController } from './shop-applications.controller';
import { ShopCreatorApplicationsController } from './shop-creator-applications.controller';
import { ShopCreatorsController } from './shop-creators.controller';
import { ShopInvitesController } from './shop-invites.controller';
import { ShopCreateController } from './shop-create.controller';

@Module({
  controllers: [
    ShopSalesController,
    ShopApplicationsController,
    ShopCreatorApplicationsController,
    ShopCreatorsController,
    // 追加
    ShopDashboardController,
    ShopSelfController,
    ShopInvitesController,
    ShopCreateController,
  ],
  providers: [
    PrismaService,
    NotificationsService,
  ],
  exports: [
    PrismaService,
  ],
})
export class ShopsModule {}
