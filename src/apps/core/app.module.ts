// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CreatorsModule } from '../creators/creators.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { PlansModule } from '../plans/plans.module';
import { PostsModule } from '../posts/posts.module';
import { UsersMeSummaryModule } from '../users/me/summary/users-me-summary.module';
import { PaymentsModule } from '../payments/payments.module';
import configuration from '../../config/configuration';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { AdminModule } from '../admin/admin.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { S3Service } from '../s3/s3.service';
import { MediaController } from '../media/media.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load:[configuration],
      envFilePath: ['.env', '.env.local'], // 必要なら複数
    }), // ← これで process.env を読み込む
    UsersModule,
    AuthModule,
    CreatorsModule,
    AdminModule,
    PlansModule,
    PostsModule,
    UsersMeSummaryModule,
    PaymentsModule,
    SubscriptionsModule,
  ],
  providers: [
    AppService,
    S3Service,
  ],
  controllers:[
    AppController,
    MediaController,
  ],
})
export class AppModule {}
