// src/apps/subscriptions/subscriptions.module.ts
import { Module } from '@nestjs/common';
import { SubscriptionsController } from './subscriptions.controller';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [SubscriptionsController],
  providers: [PrismaService],
})
export class SubscriptionsModule {}
