import { Module } from '@nestjs/common';
import { PrismaService } from 'src/apps/prisma/prisma.service';
import { AccessControlService } from './access-control.service';

@Module({
  providers: [PrismaService, AccessControlService],
  exports: [AccessControlService],
})
export class AccessControlModule {}
