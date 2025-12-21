// src/apps/posts/posts.service.ts

import { Injectable } from '@nestjs/common';
import { PostsCreatorService } from './posts.creator.service';
import { PostsEditService } from './posts.edit.service';
import { PostsPublicService } from './posts.public.service';
import { PostsAdminService } from './posts.admin.service';
import { PostsMyService } from './posts.my.service';
import { UpdatePostDto } from './dto/update-post.dto';

@Injectable()
export class PostsService {
  constructor(
    private readonly creatorSvc: PostsCreatorService,
    private readonly editSvc: PostsEditService,
    private readonly publicSvc: PostsPublicService,
    private readonly adminSvc: PostsAdminService,
    private readonly mySvc: PostsMyService,
  ) {}

  createPost(userId: string, dto: any) {
    return this.creatorSvc.createPost(userId, dto);
  }

  getPostDetail(postId: string, viewerId: string | null) {
    return this.publicSvc.getPostDetail(postId, viewerId);
  }

  updateMyPost(userId: string, postId: string, dto: UpdatePostDto) {
    return this.editSvc.updateMyPost(userId, postId, dto);
  }

  attachMediaToPost(
    postId: string,
    userId: string,
    media: any[],
    sampleIdx?: number,
  ) {
    return this.editSvc.attachMediaToPost(postId, userId, media, sampleIdx);
  }

  getMyPosts(userId: string) {
    return this.mySvc.getMyPosts(userId);
  }

  getPublicFeed() {
    return this.publicSvc.getPublicFeed();
  }

  reportPost(userId: string, postId: string, reason: string) {
    // 元のままでもいいけど publicSvc に寄せるなら移してOK
    // ここは一旦省略したければ publicSvc に移動してもOK
    throw new Error('move reportPost here or keep in a separate service');
  }

  getAdminPosts(limit = 5) {
    return this.adminSvc.getAdminPosts(limit);
  }

  listPublic(opts: { onlyOfficial: boolean }) {
    return this.publicSvc.listPublic(opts);
  }

  listByGenre(genreId: string) {
    return this.publicSvc.listByGenre(genreId);
  }
}
