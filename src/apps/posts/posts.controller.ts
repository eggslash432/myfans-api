import {
  Controller,
  Get,
  Param,
  Req,
  UseGuards,
  Post as PostMethod,
  Body,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import Stripe from 'stripe';

import { PostsService } from './posts.service';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentKind, PaymentStatus } from '@prisma/client';

@Controller('posts')
export class PostsController {
  constructor(
    private readonly posts: PostsService,
    private readonly prisma: PrismaService,
  ) {}

  // 新規: 自分の投稿一覧
  @UseGuards(JwtAuthGuard)
  @Get('me')
  async myPosts(@Req() req: any) {
    const userId = req.user?.sub;
    if (!userId) return [];

    const posts = await this.prisma.post.findMany({
      where: { creatorId: userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        visibility: true,
        priceJpy: true,
        isPublished: true,
        publishedAt: true,
        createdAt: true,
      },
    });

    return { items: posts };
  }

  @UseGuards(OptionalJwtAuthGuard) // 未ログインでもOKにする
  @Get(':id')
  async findOne(@Param('id') id: string, @Req() req: any) {
    const viewerId: string | undefined = req.user?.sub ?? req.user?.id; // どちらでも取れるように
    const now = new Date();

    const post = await this.prisma.post.findUnique({
      where: { id },
      select: {
        id: true, title: true, bodyMd: true, visibility: true,
        priceJpy: true, isPublished: true, publishedAt: true,
        creatorId: true, creator: { select: { userId: true } },
      },
    });
    if (!post) throw new NotFoundException('post not found');

    // 作者本人は常に可
    if (viewerId && viewerId === post.creatorId) return post;

    // 未公開は作者以外見れない
    if (!post.isPublished) throw new ForbiddenException('この投稿は未公開です');

    // 無料は誰でも可
    if (post.visibility === 'free') return post;

    // ここから有料
    if (!viewerId) throw new ForbiddenException('購読/購入が必要です');

    // 購読者チェック（テーブル名/フィールドはプロジェクトに合わせて調整）
    const sub = await this.prisma.subscription.findFirst({
      where: {
        userId: viewerId,
        status: 'active',
        plan :{
          creatorId: post.creatorId,
        },
        currentPeriodStart: { lte: now },
        currentPeriodEnd:   { gte: now },
      },
      select: { id: true },
    });

    // PPV購入チェック（支払いテーブル名/カラム名は合わせて）
    const ppv = await this.prisma.payment.findFirst({
      where: {
        userId: viewerId,
        postId: post.id,
        status: PaymentStatus.paid,
        kind: PaymentKind.one_time, // or method: 'ppv'
      },
      select: { id: true },
    });

    if (sub || ppv) return post;

    throw new ForbiddenException('この投稿を閲覧する権限がありません');
  }

  // 公開フィード（新着投稿）
  @UseGuards(OptionalJwtAuthGuard)
  @Get('public-feed')
  async publicFeed() {
    return this.prisma.post.findMany({
      where: { isPublished: true },               // ← 修正
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        title: true,
        priceJpy: true,
        visibility: true, // 'free' | 'paid_single' | 'members_only'
        creator: { select: { publicName: true } },      // ← displayName ではなくスキーマ実名に
        createdAt: true,
      },
    });
  }

  // 投稿メタ情報（公開）
  @UseGuards(OptionalJwtAuthGuard)
  @Get(':id/meta')
  async meta(@Param('id') id: string) {
    return this.prisma.post.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        priceJpy: true,
        visibility: true,
        creator: { select: { publicName: true } },      // ← schema に合わせて displayName を使用
      },
    });
  }

  // 投稿本文（保護：購入/購読チェック）
  @UseGuards(JwtAuthGuard)
  @Get(':id/content')
  async content(@Param('id') id: string, @Req() req: any) {
    const post = await this.prisma.post.findUnique({ where: { id } });
    if (!post || !post.isPublished) throw new NotFoundException();  // ← 修正

    // free は誰でもOK
    if (post.visibility === 'free') return { content: post.bodyMd }; // ← bodyHtml → bodyMd

    // paid_single は PostAccess を確認
    if (post.visibility === 'paid_single') {
      const has = await this.prisma.postAccess.findUnique({
        where: { userId_postId: { userId: req.user.id, postId: id } },
      });
      if (has) return { content: post.bodyMd }; // ← 修正
      throw new ForbiddenException(); // 未購入
    }

    // members_only（将来用）：ここでは 403
    throw new ForbiddenException();
  }

  // 単発購入用 Checkout セッション作成
  @UseGuards(JwtAuthGuard)
  @PostMethod('checkout/post')
  async checkoutPost(@Body() body: { postId: string }, @Req() req: any) {
    const { postId } = body;
    const post = await this.prisma.post.findUnique({ where: { id: postId } });
    if (!post || post.visibility !== 'paid_single') {
      throw new BadRequestException('purchase not allowed');
    }
    if (post.priceJpy == null || post.priceJpy <= 0) {
      throw new BadRequestException('invalid price');
    }

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY! /*, {
      // 型エラーを避けるため、apiVersionは指定しない or プロジェクトの型に一致させる
      // apiVersion: '2025-09-30', // ← stripe の型が期待する最新に合わせるならこちら
    }*/);

    // 既存顧客再利用にするなら find/create ロジックを分岐
    const customer = await stripe.customers.create({
      email: req.user.email,
      metadata: { userId: req.user.id },
    });

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer: customer.id,
      line_items: [
        {
          price_data: {
            currency: 'jpy',
            // JPYはゼロ小数。×100 しない！
            unit_amount: post.priceJpy,                      // ← 修正
            product_data: { name: `Post: ${post.title}` },
          },
          quantity: 1,
        },
      ],
      success_url: `${process.env.FRONT_URL}/mypage?success=1`,
      cancel_url: `${process.env.FRONT_URL}/posts/${postId}`,
      metadata: { userId: req.user.id, postId },
    });

    return { sessionId: session.id, url: session.url };
  }
}
