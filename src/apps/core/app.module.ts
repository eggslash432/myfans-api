// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CreatorsModule } from '../creators/creators.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { PlansModule } from '../plans/plans.module';
import { PostsModule } from '../posts/posts.module';
import { UsersMeSummaryModule } from '../users/me/summary/users-me-summary.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }), // ← これで process.env を読み込む
    UsersModule,
    AuthModule,
    CreatorsModule,
    PlansModule,
    PostsModule,
    UsersMeSummaryModule,
  ],
})
export class AppModule {}
