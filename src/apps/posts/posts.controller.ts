// api/src/apps/posts/posts.controller.ts
import {
  Controller,
  Get,
  Param,
  Req,
  UseGuards,
  Post as PostMethod,
  Body,
  ForbiddenException,
  NotFoundException,
  UseInterceptors,
  UploadedFiles,
  Patch,
  UnauthorizedException,
  BadRequestException,
  PayloadTooLargeException,
  Delete,
  Query,
} from '@nestjs/common';

import { PostsService } from './posts.service';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UserJwt } from 'src/shared/types';

import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import sharp from 'sharp';
import { promises as fs } from 'fs';

import { UpdatePostDto } from './dto/update-post.dto';
import { PrismaService } from '../prisma/prisma.service';
import { PostDeleteService } from './post-delete.service';

// ✅ S3Service は使わない（切替は Storage 側へ委譲）
import { MediaStorageService } from '../storage/media-storage.service';

@Controller('posts')
export class PostsController {
  constructor(
    private readonly postsService: PostsService,
    private readonly prisma: PrismaService,
    private readonly postDelete: PostDeleteService,
    private readonly mediaStorage: MediaStorageService,
  ) {}

  // ==============================
  // Public feed
  // GET /posts
  // ==============================
  @Get()
  async listPublicPosts() {
    const items = await this.postsService.getPublicFeed();
    return { items };
  }

  // ==============================
  // Admin posts (public)
  // GET /posts/public/admin
  // ==============================
  @Get('public/admin')
  async getAdminPosts() {
    return this.postsService.getAdminPosts(5);
  }

  // ==============================
  // My posts
  // GET /posts/me
  // ==============================
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getMyPosts(@Req() req: any) {
    const userId = req.user?.id;
    if (!userId) throw new UnauthorizedException('JWTが無効です');

    const posts = await this.prisma.post.findMany({
      where: { creatorId: userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        visibility: true,
        priceJpy: true,
        publishedStatus: true,
        publishedAt: true,
        createdAt: true,
        creatorId: true,
      },
    });

    return { items: posts };
  }

  // ==============================
  // Post detail (optional login)
  // GET /posts/:id
  // ==============================
  @UseGuards(OptionalJwtAuthGuard)
  @Get(':id')
  async getPost(@Param('id') id: string, @Req() req: any) {
    const user = req.user as UserJwt | undefined;
    const viewerId = user?.id ?? null;

    const detail = await this.postsService.getPostDetail(id, viewerId);
    if (!detail) throw new NotFoundException('投稿が見つかりません');

    return detail;
  }


  // ==============================
  // Upload media
  // POST /posts/:id/media
  // ==============================
  @UseGuards(JwtAuthGuard)
  @PostMethod(':id/media')
  @UseInterceptors(
    FilesInterceptor('files', 20, {
      storage: diskStorage({
        destination: 'tmp/uploads/posts',
        filename: (req, file, cb) => {
          const ext = extname(file.originalname);
          cb(null, `post-${req.params.id}-${Date.now()}${ext}`);
        },
      }),
      // multer で落とさない（本当の制限はDB設定で）
      limits: { fileSize: 1024 * 1024 * 1024 }, // 1GB
    }),
  )
  async uploadMedia(
    @Param('id') postId: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Req() req: any,
    @Body('sampleIndex') sampleIndex?: string,
  ) {
    const user = req.user as UserJwt | undefined;
    if (!user?.id) throw new ForbiddenException('ログインが必要です');

    // DBのアップロード設定を読む（無ければデフォルト）
    const setting = await this.prisma.uploadSetting.findUnique({
      where: { id: 1 },
    });

    const maxFiles = setting?.maxFiles ?? 10;
    const maxFileSizeMb = setting?.maxFileSizeMb ?? 20;
    const maxBytes = maxFileSizeMb * 1024 * 1024;

    // ---- 枚数制限（超えてたら tmp を削除して落とす）----
    if ((files?.length ?? 0) > maxFiles) {
      await Promise.all(
        (files ?? []).map((f) => fs.unlink(f.path).catch(() => {})),
      );
      throw new BadRequestException(
        `ファイル数が上限を超えています（最大 ${maxFiles} 件）`,
      );
    }

    // ---- サイズ制限（超えてたら tmp を削除して落とす）----
    const tooLarge = (files ?? []).find((f) => (f.size ?? 0) > maxBytes);
    if (tooLarge) {
      await Promise.all(
        (files ?? []).map((f) => fs.unlink(f.path).catch(() => {})),
      );
      throw new PayloadTooLargeException(
        `ファイルサイズが上限を超えています（最大 ${maxFileSizeMb}MB）`,
      );
    }

    // ---- 画像だけリサイズ（tmp 上で）----
    await Promise.all(
      (files ?? [])
        .filter((f) => f.mimetype.startsWith('image/'))
        .map(async (file) => {
          const inputPath = file.path;
          const tmpPath = `${inputPath}.tmp`;

          const img = sharp(inputPath);
          const meta = await img.metadata();
          const format =
            meta.format ?? (file.mimetype.includes('png') ? 'png' : 'jpeg');

          const pipeline = img.resize({
            width: 1280,
            height: 1280,
            fit: 'inside',
            withoutEnlargement: true,
          });

          if (format === 'jpeg' || format === 'jpg') {
            await pipeline.jpeg({ quality: 80 }).toFile(tmpPath);
          } else if (format === 'png') {
            await pipeline.png({ compressionLevel: 8 }).toFile(tmpPath);
          } else {
            await pipeline.toFile(tmpPath);
          }

          await fs.rename(tmpPath, inputPath);
        }),
    );

    // sampleIndex の確定（NaN / 範囲外は無効）
    const raw = sampleIndex !== undefined ? Number(sampleIndex) : null;
    const sampleIdx =
      raw !== null &&
      Number.isInteger(raw) &&
      raw >= 0 &&
      raw < (files?.length ?? 0)
        ? raw
        : null;

    // ✅ tmp -> localならuploadsへ移動 / s3ならuploadしてtmp削除 を MediaStorageService に委譲
    const uploadedMedia = await Promise.all(
      (files ?? []).map(async (f) => {
        const url = await this.mediaStorage.savePostFileFromTemp({
          postId,
          tmpPath: f.path,
          originalName: f.originalname,
          contentType: f.mimetype,
        });
        return { url, mime: f.mimetype, originalName: f.originalname };
      }),
    );

    const items = await this.postsService.attachMediaToPost(
      postId,
      user.id,
      uploadedMedia,
      sampleIdx ?? undefined,
    );

    return { ok: true, items };
  }

  // ==============================
  // Update my post
  // PATCH /posts/me/:id
  // ==============================
  @UseGuards(JwtAuthGuard)
  @Patch('me/:id')
  async updateMyPost(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdatePostDto,
  ) {
    const userId: string | undefined = req.user?.id;
    if (!userId) throw new UnauthorizedException('JWTが無効です');
    return this.postsService.updateMyPost(userId, id, dto);
  }

  // ==============================
  // Delete my post
  // DELETE /posts/me/:id
  // ==============================
  @UseGuards(JwtAuthGuard)
  @Delete('me/:id')
  async deleteMyPost(@Req() req: any, @Param('id') id: string) {
    const user = req.user as UserJwt | undefined;
    if (!user?.id) throw new UnauthorizedException('ログインが必要です');
    return this.postDelete.deleteAsCreator(id, user.id);
  }

  // ==============================
  // Alternate list endpoint (avoid @Get() collision)
  // GET /posts/list?official=1
  // ==============================
  @Get('list')
  list(@Query('official') official?: string) {
    const onlyOfficial = official === '1' || official === 'true';
    return this.postsService.listPublic({ onlyOfficial });
  }

  @Get('by-genre/:genreId')
  async listByGenre(@Param('genreId') genreId: string) {
    if (!genreId) {
      throw new BadRequestException('genreId is required');
    }

    const items = await this.postsService.listByGenre(genreId);
    return { items };
  }  
}
