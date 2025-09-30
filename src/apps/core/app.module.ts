// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CreatorsModule } from '../creators/creators.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }), // ← これで process.env を読み込む
    UsersModule,
    AuthModule,
    CreatorsModule,
  ],
})
export class AppModule {}
