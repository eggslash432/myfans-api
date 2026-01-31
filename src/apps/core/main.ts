// api/src/apps/core/main.ts

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import 'dotenv/config';
import * as bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { IS_MEDIA_LOCAL } from 'src/shared/media-env';
import * as express from 'express'; 
import { ErrorLogService } from '../error-log/error-log.service';
import { HttpErrorLogFilter } from '../error-log/http-exception.filter';

function ensureUploadDirs() {
  const dirs = [
    'uploads',
    'uploads/creators',
    'uploads/posts',
    'uploads/announcements', // ✅ 追加
  ].map((p) => join(process.cwd(), p));
  dirs.forEach((d) => mkdirSync(d, { recursive: true }));
}

async function bootstrap() {
  if (IS_MEDIA_LOCAL) ensureUploadDirs();

  const app = await NestFactory.create(AppModule, { rawBody: true });

  // ✅ 静的配信（prefixとは独立）
  // MediaStorageService が返す URL が "/uploads/..." なのでここは "/uploads" で出す
  if (IS_MEDIA_LOCAL) {
    app.use('/uploads', express.static(join(process.cwd(), 'uploads')));
  }

  // ✅ prefix
  app.setGlobalPrefix('api');

  // ✅ Stripe webhook は raw body 必須
  app.use('/api/stripe/webhook', bodyParser.raw({ type: 'application/json' }));
  app.use('/api/payments/webhook', bodyParser.raw({ type: 'application/json' }));

  // ✅ それ以外は通常の JSON
  app.use(bodyParser.json({ limit: '10mb' }));
  app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors({
    origin: ['http://localhost:5173', 'https://d2d1zk1rp5q7z8.cloudfront.net'],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'stripe-signature'],
    exposedHeaders: ['set-cookie'],
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('MyFans API')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const doc = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, doc);

  const errorLog = app.get(ErrorLogService);
  app.useGlobalFilters(new HttpErrorLogFilter(errorLog));  

  await app.listen(process.env.PORT || 3000);
}
bootstrap();
