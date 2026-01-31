// api/src/apps/shops/business-license.module.ts

import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessLicenseController } from './business-license.controller';
import { BusinessLicenseService } from './business-license.service';

@Module({
  controllers: [BusinessLicenseController],
  providers: [BusinessLicenseService, PrismaService],
})
export class BusinessLicenseModule {}
