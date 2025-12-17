import { Module } from '@nestjs/common';
import { PostsService } from './posts.service';
import { PostsController } from './posts.controller';
import { PrismaService } from '../prisma/prisma.service';
import { AccessControlModule } from '../access-control/access-control.module';
import { PostsCreateController } from './posts.create.controller';
import { PostsMediaController } from './posts.media.controller';
import { HelpersModule } from '../helpers/helpers.module';
import { PostsFetchController } from './posts.fetch.controller';
import { PostsReportController } from './posts.report.controller';
import { PostDeleteService } from './post-delete.service';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    AccessControlModule, 
    HelpersModule,
    StorageModule,
  ],
  exports: [
    PostDeleteService
  ],
  providers: [
    PostsService, 
    PrismaService, 
    PostDeleteService,
  ],
  controllers: [
    PostsController,
    PostsCreateController, 
    PostsMediaController, 
    PostsFetchController,
    PostsReportController,
  ],
})
export class PostsModule {}
