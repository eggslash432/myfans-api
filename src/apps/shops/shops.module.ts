// api/src/apps/shops/shops.module.ts

import { Module } from '@nestjs/common';

// 共通サービス
import { PrismaService } from '../prisma/prisma.service';

import { ShopSelfController } from './shop-self.controller';
import { ShopInvitesController } from './shop-invites.controller';
import { ShopCreateController } from './shop-create.controller';
import { ShopAuthService } from './shop-auth.service';

@Module({
  controllers: [
    ShopSelfController,
    ShopInvitesController,
    ShopCreateController,
  ],
  providers: [
    PrismaService,
    ShopAuthService,
  ],
  exports: [
    PrismaService,
  ],
})
export class ShopsModule {}
