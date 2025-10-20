import { Module } from '@nestjs/common';
import { AdminCreatorsController } from './admin-creators.controller';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [AdminCreatorsController],
  providers: [PrismaService],
})
export class AdminModule {}
