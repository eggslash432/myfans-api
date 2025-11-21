import { Module } from '@nestjs/common';
import { PostsService } from './posts.service';
import { PostsController } from './posts.controller';
import { PrismaService } from '../prisma/prisma.service';
import { AccessControlModule } from '../access-control/access-control.module';
import { PostsCreateController } from './posts.create.controller';
import { PostsMediaController } from './posts.media.controller';
import { S3Service } from '../s3/s3.service';
import { HelpersModule } from '../helpers/helpers.module';
import { PostsFetchController } from './posts.fetch.controller';

@Module({
  imports: [AccessControlModule, HelpersModule],
  providers: [PostsService, PrismaService, S3Service],
  controllers: [PostsController,PostsCreateController, PostsMediaController, PostsFetchController],
})
export class PostsModule {}
