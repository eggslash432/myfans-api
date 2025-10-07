import { Module } from '@nestjs/common'
import { UsersMeSummaryController } from './users-me-summary.controller'
import { UsersMeSummaryService } from './users-me-summary.service'
import { PrismaService } from '../../../prisma/prisma.service'

@Module({
  controllers: [UsersMeSummaryController],
  providers: [UsersMeSummaryService, PrismaService],
})
export class UsersMeSummaryModule {}
