//api/src/apps/help/help.module.ts

import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HelpController } from './help.controller';
import { HelpAdminController } from './help.admin.controller';
import { HelpService } from './help.service';

@Module({
  controllers: [HelpController, HelpAdminController],
  providers: [HelpService, PrismaService],
})
export class HelpModule {}
