import { Module } from '@nestjs/common';
import { PlansService } from './plans.service';
import { PlansController } from './plans.controller';
import { PrismaService } from '../prisma/prisma.service';
import { HelpersModule } from '../helpers/helpers.module';

@Module({
  imports:[HelpersModule],
  controllers: [PlansController],
  providers: [PlansService, PrismaService],
})
export class PlansModule {}
