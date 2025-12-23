// src/apps/payouts/payouts.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';

import { PayoutsBalanceService } from './payouts-balance.service';
import { PayoutsRequestsService } from './payouts-requests.service';
import { PayoutsAdminService } from './payouts-admin.service';

@Module({
  imports: [PrismaModule],
  providers: [PayoutsBalanceService, PayoutsRequestsService, PayoutsAdminService],
  exports: [PayoutsBalanceService, PayoutsRequestsService, PayoutsAdminService],
})
export class PayoutsModule {}