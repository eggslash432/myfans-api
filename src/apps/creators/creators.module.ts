import { Module } from '@nestjs/common';
import { CreatorsController } from './creators.controller';
import { CreatorsService } from './creators.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  controllers: [CreatorsController],
  providers: [CreatorsService, PrismaService],
})
export class CreatorsModule {}