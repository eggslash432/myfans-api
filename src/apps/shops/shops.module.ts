// api/src/apps/shops/shops.module.ts
import { Module } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

import { ShopInvitesController } from './shop-invites.controller';
import { ShopCreateController } from './shop-create.controller';
import { ShopAuthService } from './shop-auth.service';

import { ShopCreatorApplicationsController } from './shop-creator-applications.controller';
import { ShopSalesController } from './shop-sales.controller';
import { ShopCreatorsController } from './shop-creators.controller';
import { ShopDashboardController } from './shop-dashboard.controller';
import { ShopMeController } from './shop-me.controller';
import { ShopPayoutController } from './shop-payout.controller';
import { ShopPayoutService } from './shop-payout.service';
import { PaymentsModule } from '../payments/payments.module';
import { PayoutsModule } from '../payments/payouts.module';

@Module({
  imports:[
    PaymentsModule,
    PayoutsModule,
  ],
  controllers: [
    ShopInvitesController,
    ShopCreateController,

    ShopCreatorApplicationsController,
    ShopSalesController,
    ShopCreatorsController,
    ShopDashboardController,
    ShopMeController,

    ShopPayoutController,
  ],
  providers: [
    PrismaService,
    ShopAuthService,
    ShopPayoutService,
  ],
  exports: [
    PrismaService,
  ],
})
export class ShopsModule {}
