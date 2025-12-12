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
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Controller('posts')
export class PostsController {
  constructor(
    private readonly postsService: PostsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async listPublicPosts() {
    const items = await this.postsService.getPublicFeed();
    return { items };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async myPosts(@Req() req: any) {
    const user = req.user as UserJwt | undefined;
    if (!user?.id) throw new ForbiddenException('ログインが必要です');

    const posts = await this.postsService.getMyPosts(user.id, user.role as Role);
    return { items: posts };
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get(':id')
  async getPost(@Param('id') id: string, @Req() req: any) {
    const user = req.user as UserJwt | undefined;
    const viewerId = user?.id ?? null;

    const detail = await this.postsService.getPostDetail(id, viewerId);
    if (!detail) throw new NotFoundException('投稿が見つかりません');

    return detail;
  }

  @UseGuards(JwtAuthGuard)
  @PostMethod(':id/report')
  async reportPost(
    @Param('id') id: string,
    @Body() body: { reason?: string },
    @Req() req: any,
  ) {
    const user = req.user as UserJwt | undefined;
    if (!user?.id) throw new ForbiddenException('ログインが必要です');

    const reason = body.reason ?? '';
    return this.postsService.reportPost(user.id, id, reason);
  }

  // --------------------------------------------------
  // 投稿メディアのアップロード
  // POST /posts/:id/media
  // --------------------------------------------------
  @UseGuards(JwtAuthGuard)
  @PostMethod(':id/media')
  @UseInterceptors(
    // ★ ここは「大きめ」にしておく（DB設定で実際の制限を判定する）
    // maxFiles も DB で制限するので、ここは大きめでOK
    FilesInterceptor('files', 20, {
      storage: diskStorage({
        destination: 'uploads/posts',
        filename: (req, file, cb) => {
          const ext = extname(file.originalname);
          const name = `post-${req.params.id}-${Date.now()}${ext}`;
          cb(null, name);
        },
      }),
      // ★ multer の fileSize 制限に引っかかると DB 参照前に落ちるので
      //    いったん大きめにして「後でDB設定で落とす」
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

    // ★ DBのアップロード設定を読む（無ければデフォルト）
    const setting = await this.prisma.uploadSetting.findUnique({
      where: { id: 1 },
    });

    const maxFiles = setting?.maxFiles ?? 10;
    const maxFileSizeMb = setting?.maxFileSizeMb ?? 20;
    const maxBytes = maxFileSizeMb * 1024 * 1024;

    // ---- まず枚数制限（超えてたら保存済みを削除）----
    if ((files?.length ?? 0) > maxFiles) {
      await Promise.all((files ?? []).map((f) => fs.unlink(f.path).catch(() => {})));
      throw new BadRequestException(`ファイル数が上限を超えています（最大 ${maxFiles} 件）`);
    }

    // ---- 次にサイズ制限（超えてたら保存済みを削除）----
    const tooLarge = (files ?? []).find((f) => (f.size ?? 0) > maxBytes);
    if (tooLarge) {
      await Promise.all((files ?? []).map((f) => fs.unlink(f.path).catch(() => {})));
      throw new PayloadTooLargeException(
        `ファイルサイズが上限を超えています（最大 ${maxFileSizeMb}MB）`,
      );
    }

    // 画像だけリサイズ（あなたの処理はそのままOK）
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

    // ★ sampleIndex の確定（NaN / 範囲外は無効）
    const raw = sampleIndex !== undefined ? Number(sampleIndex) : null;
    const sampleIdx =
      raw !== null &&
      Number.isInteger(raw) &&
      raw >= 0 &&
      raw < (files?.length ?? 0)
        ? raw
        : null;

    // attachMediaToPost 側で sampleIdx を扱う想定
    const items = await this.postsService.attachMediaToPost(
      postId,
      user.id,
      files,
      sampleIdx ?? undefined,
    );

    return { ok: true, items };
  }

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

  @Get('public/admin')
  async getAdminPosts() {
    return this.postsService.getAdminPosts(5);
  }
}
