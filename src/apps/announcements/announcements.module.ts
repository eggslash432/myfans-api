// api/src/apps/announcements/announcements.module.ts
import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AnnouncementsController } from './announcements.controller';

@Module({
  controllers: [AnnouncementsController],
  providers: [PrismaService],
})
export class AnnouncementsModule {}
