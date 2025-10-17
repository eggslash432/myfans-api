import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import 'dotenv/config';
import * as bodyParser from 'body-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // バリデーション
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  // CORS（必要に応じてステージングのフロントURLを追加）
  app.enableCors({
    origin: [
      'http://localhost:5173',
      'https://myfans-frontend.onrender.com',
    ], // 'https://myfans-frontend-stg.vercel.app' なども追加可
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['set-cookie'],
  });

  // Stripe Webhook は raw body 必須 → ルートに合わせて設定
  // 実装: @Post('webhooks/stripe') → /payments/webhooks/stripe
  app.use('/payments/webhooks/stripe', bodyParser.raw({ type: 'application/json' }));
  // その他は通常の JSON ボディ
  app.use(bodyParser.json());

  // ヘルスチェック（listen前に定義）
  app.getHttpAdapter().get('/health', (_req, res) =>
    res.send({ status: 'ok', time: new Date().toISOString() }),
  );

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
