// api/src/apps/core/main.ts

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import 'dotenv/config';
import * as bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import * as express from 'express';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { IS_MEDIA_LOCAL } from 'src/shared/media-env';

function ensureUploadDirs() {
  const dirs = [
    'uploads',
    'uploads/creators',
    'uploads/posts',
  ].map((p) => join(process.cwd(), p));

  dirs.forEach((d) => mkdirSync(d, { recursive: true }));
}

async function bootstrap() {
  // ✅ ローカルだけ作る（productionでは不要）
  if (IS_MEDIA_LOCAL) {
    ensureUploadDirs();
  }

  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.setGlobalPrefix('api');

  // バリデーション
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  // CORS（必要に応じてステージングのフロントURLを追加）
  app.enableCors({
    origin: [
      'http://localhost:5173',
      'https://d2d1zk1rp5q7z8.cloudfront.net',
    ], // 'https://myfans-frontend-stg.vercel.app' なども追加可
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['set-cookie'],
  });
  
  // Stripe Webhook は raw body 必須 → ルートに合わせて設定
  // 実装: @Post('webhooks/stripe') → /payments/webhooks/stripe
  app.use('/api/payments/webhook', bodyParser.raw({ type: 'application/json' }));
  // かつ bodyParser.json の verify で req.rawBody をセット
  app.use(
    bodyParser.json({
      verify: (req: any, res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(cookieParser());

  // Swagger（docs）
  const config = new DocumentBuilder()
    .setTitle('MyFans API')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const doc = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, doc);

  // ★ ポート待受は１回だけ
  await app.listen(process.env.PORT || 3000);
}
bootstrap();
