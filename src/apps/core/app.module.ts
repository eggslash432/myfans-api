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
import { join } from 'path';
import { IS_MEDIA_LOCAL } from 'src/shared/media-env';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ShopsModule } from '../shops/shops.module';
import { AnnouncementsModule } from '../announcements/announcements.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load:[configuration],
      envFilePath: ['.env', '.env.local'], // 必要なら複数
    }), // ← これで process.env を読み込む
    // ✅ ローカル開発だけ /uploads を静的配信
    ...(IS_MEDIA_LOCAL
      ? [
          ServeStaticModule.forRoot({
            rootPath: join(process.cwd(), 'uploads'), // uploads/* を配信
            serveRoot: '/uploads', // URL は /uploads/...
            serveStaticOptions: {
              // キャッシュが邪魔なら短め（dev向け）
              maxAge: 0,
            },
          }),
        ]
      : []),    
    UsersModule,
    AuthModule,
    CreatorsModule,
    AdminModule,
    PlansModule,
    PostsModule,
    UsersMeSummaryModule,
    PaymentsModule,
    SubscriptionsModule,
    ShopsModule,
    AnnouncementsModule,
  ],
  providers: [
    AppService,
  ],
  controllers:[
    AppController,
  ],
})
export class AppModule {}
