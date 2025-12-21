import { Module } from '@nestjs/common';
import { CreatorsService } from './creators.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreatorPayoutsController } from './creator-payouts.controller';
import { HelpersModule } from '../helpers/helpers.module';
import { ConfigModule } from '@nestjs/config';
import { CreatorKycController } from './creator-kyc.controller';
import { CreatorApplicationsController } from './creator-applications.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { StorageModule } from '../storage/storage.module';
import { CreatorApplyService } from './apply/creator-apply.service';
import { CreatorPublicService } from './public/creator-public.service';
import { CreatorStripeService } from './stripe/creator-stripe.service';
import { CreatorAnalyticsService } from './analytics/creator-analytics.service';
import { CreatorProfileService } from './profile/creator-profile.service';
import { StripeClientProvider } from './stripe/stripe-client.provider';
import { CreatorsAnalyticsController } from './controllers/creators-analytics.controller';
import { CreatorsApplyController } from './controllers/creators-apply.controller';
import { CreatorsPublicController } from './controllers/creators-public.controller';
import { CreatorsMeController } from './controllers/creators-me.controller';
import { CreatorsCheckoutController } from './controllers/creators-checkout.controller';
import { CreatorsControllerHelpers } from './controllers/creators.controller-helpers';

@Module({
  imports: [
    HelpersModule, 
    ConfigModule,
    NotificationsModule,
    StorageModule,
  ],
  controllers: [
    CreatorPayoutsController, 
    CreatorKycController,
    CreatorApplicationsController,
    CreatorsAnalyticsController,
    CreatorsApplyController,
    CreatorsMeController,
    CreatorsPublicController,
    CreatorsCheckoutController,
  ],
  providers: [
    CreatorsService, 
    PrismaService,
    // split services
    CreatorApplyService,
    CreatorPublicService,
    CreatorStripeService,
    CreatorAnalyticsService,
    CreatorProfileService,

    // stripe client
    StripeClientProvider,

    CreatorsControllerHelpers,
  ],
})
export class CreatorsModule {}