// api/src/apps/admin/creators/admin-creators.module.ts

import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminCreatorsController } from './admin-creators.controller';
import { AdminCreatorsService } from './admin-creators.service';

@Module({
  controllers: [
    AdminCreatorsController
  ],
  providers: [
    AdminCreatorsService, 
    PrismaService,
  ],
})
export class AdminCreatorsModule {}
