// src/apps/payouts/payouts.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';

import { PayoutsBalanceService } from './services/payouts-balance.service';
import { PayoutsRequestsService } from './services/payouts-requests.service';
import { PayoutsAdminService } from './services/payouts-admin.service';

@Module({
  imports: [PrismaModule],
  providers: [PayoutsBalanceService, PayoutsRequestsService, PayoutsAdminService],
  exports: [PayoutsBalanceService, PayoutsRequestsService, PayoutsAdminService],
})
export class PayoutsModule {}