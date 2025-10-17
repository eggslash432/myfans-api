import { Module } from '@nestjs/common';
import { PostsService } from './posts.service';
import { PostsController } from './posts.controller';
import { PrismaService } from '../prisma/prisma.service';
import { AccessControlModule } from '../access-control/access-control.module';
import { PostsCreateController } from './posts.create.controller';

@Module({
  imports: [AccessControlModule],
  providers: [PostsService, PrismaService],
  controllers: [PostsController,PostsCreateController],
})
export class PostsModule {}
