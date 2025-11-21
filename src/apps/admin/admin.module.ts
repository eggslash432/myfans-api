import { Module } from '@nestjs/common';
import { AdminCreatorsController } from './admin-creators.controller';
import { PrismaService } from '../prisma/prisma.service';
import { AdminPostsController } from './admin.posts.controller';

@Module({
  controllers: [AdminCreatorsController, AdminCreatorsController, AdminPostsController],
  providers: [PrismaService],
})
export class AdminModule {}
