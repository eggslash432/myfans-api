// src/prisma/prisma.service.ts
import { INestApplication, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';

@Injectable()
export class PrismaService 
  extends PrismaClient 
  implements OnModuleInit, OnModuleDestroy 
{
  constructor() {
    super({
      log: ['query', 'info', 'warn', 'error'],
    });

    console.log('PrismaService: DATABASE_URL =', process.env.DATABASE_URL);
  }

  async onModuleInit() {
    await this.$connect();
  }

  // $on('beforeExit') の代替：Nest の終了と連動
  async enableShutdownHooks(app: INestApplication) {
    process.on('beforeExit', async () => {
      await app.close();
    });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
