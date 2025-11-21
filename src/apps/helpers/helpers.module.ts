// src/apps/helpers/helpers.module.ts

import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccessCheckHelper } from './access-check.helper';
import { CreatorHelper } from './creator.helper';

@Module({
  providers: [PrismaService, AccessCheckHelper, CreatorHelper],
  exports: [AccessCheckHelper, CreatorHelper],
})
export class HelpersModule {}