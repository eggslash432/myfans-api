import { Module } from '@nestjs/common';
import { CreatorsController } from './creators.controller';
import { CreatorsService } from './creators.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreatorPayoutsController } from './creator-payouts.controller';
import { HelpersModule } from '../helpers/helpers.module';
import { ConfigModule } from '@nestjs/config';
import { CreatorKycController } from './creator-kyc.controller';
import { CreatorApplicationsController } from './creator-applications.controller';

@Module({
  imports: [
    HelpersModule, 
    ConfigModule
  ],
  controllers: [
    CreatorsController, 
    CreatorPayoutsController, 
    CreatorKycController,
    CreatorApplicationsController,
  ],
  providers: [
    CreatorsService, 
    PrismaService
  ],
})
export class CreatorsModule {}