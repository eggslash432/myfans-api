// api/src/apps/legal/legal.module.ts

import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LegalController } from './legal.controller';
import { LegalService } from './legal.service';

@Module({
  controllers: [LegalController],
  providers: [LegalService, PrismaService],
})
export class LegalModule {}
