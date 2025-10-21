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
  Post,
} from '@nestjs/common';
import Stripe from 'stripe';

import { PostsService } from './posts.service';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentKind, PaymentStatus, PublishedStatus, Visibility } from '@prisma/client';
import { getMyCreatorId } from '../helpers/creator';
import { CreatePostDto } from './dto/create-post.dto';
import { access } from 'fs';

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
        publishedStatus: true,
        publishedAt: true,
        createdAt: true,
      },
    });

    return { items: posts };
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get(':id')
  async findOne(@Param('id') id: string, @Req() req: any) {
    const viewerId: string | undefined = req.user?.sub ?? req.user?.id; // 念のため互換
    const now = new Date();

    // まず本文なしで基本情報だけ
    const post = await this.prisma.post.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        visibility: true,
        priceJpy: true,
        publishedStatus: true,
        publishedAt: true,
        creatorId: true,
        creator: { select: { userId: true } },
      },
    });
    if (!post) throw new NotFoundException('post not found');

    // 作者本人は常に可
    if (viewerId && viewerId === post.creatorId) {
      const full = await this.prisma.post.findUnique({
        where: { id },
        select: { id: true, title: true, body: true, visibility: true, priceJpy: true, publishedStatus: true, publishedAt: true, creatorId: true },
      });
      return { ...full!, canView: true, accessType: post.visibility === Visibility.paid_single ? 'ppv' : post.visibility === Visibility.plan ? 'plan' : 'free' };
    }

    // 未公開は作者以外見れない
    if (post.publishedStatus !== PublishedStatus.published) {
      throw new ForbiddenException('この投稿は未公開です');
    }

    // accessType 決定
    const accessType =
      post.visibility === Visibility.paid_single ? 'ppv' :
      post.visibility === Visibility.plan        ? 'plan' : 'free';

    // 無料は誰でもOK → 本文付きで返す
    if (post.visibility === Visibility.free) {
      const full = await this.prisma.post.findUnique({
        where: { id },
        select: { id: true, title: true, body: true, visibility: true, priceJpy: true, publishedStatus: true, publishedAt: true, creatorId: true },
      });
      return { ...full!, canView: true, accessType: 'free' };
    }

    // ここから有料（plan / ppv）
    if (!viewerId) {
      // 未ログインは本文なしで canView:false
      return { ...post, canView: false, accessType };
    }

    // PLAN購読チェック
    let canView = false;
    if (post.visibility === Visibility.plan) {
      const hasSub = await this.prisma.subscription.findFirst({
        where: {
          userId: viewerId,
          status: { in: ['active', 'trialing'] },
          currentPeriodEnd: { gt: now },
          plan: { creatorId: post.creatorId },
        },
        select: { id: true },
      });
      canView = !!hasSub;
    }

    // PPVチェック
    if (!canView && post.visibility === Visibility.paid_single) {
      const paidByPayment = await this.prisma.payment.findFirst({
        where: {
          userId: viewerId,
          postId: post.id,
          paymentStatus: PaymentStatus.paid,
          kind: PaymentKind.one_time,
        },
        select: { id: true },
      });
      const paidByAccess = await this.prisma.postAccess.findUnique({
        where: { userId_postId: { userId: viewerId, postId: post.id } },
        select: { userId: true },
      });
      canView = !!(paidByPayment || paidByAccess);
    }

    if (canView) {
      const full = await this.prisma.post.findUnique({
        where: { id },
        select: { id: true, title: true, body: true, visibility: true, priceJpy: true, publishedStatus: true, publishedAt: true, creatorId: true },
      });
      return { ...full!, canView: true, accessType };
    }

    // 本文なしで返す
    return { ...post, canView: false, accessType };
  }


  // 公開フィード（新着投稿）
  @UseGuards(OptionalJwtAuthGuard)
  @Get('public-feed')
  async publicFeed() {
    return this.prisma.post.findMany({
      where: { publishedStatus: PublishedStatus.published },               // ← 修正
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
    if (!post || post.publishedStatus !== PublishedStatus.published) throw new NotFoundException();  // ← 修正

    // free は誰でもOK
    if (post.visibility === Visibility.free) return { content: post.body }; // ← bodyHtml → bodyMd

    // paid_single は PostAccess を確認
    if (post.visibility === Visibility.paid_single) {
      const has = await this.prisma.postAccess.findUnique({
        where: { userId_postId: { userId: req.user.id, postId: id } },
      });
      if (has) return { content: post.body }; // ← 修正
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
    if (!post || post.visibility !== Visibility.paid_single) {
      throw new BadRequestException('purchase not allowed');
    }
    if (post.priceJpy == null || post.priceJpy <= 0) {
      throw new BadRequestException('invalid price');
    }

    // ★ ここでフロントURLを必ず絶対URLに補正
    const envFront = process.env.FRONT_URL || '';
    const reqOrigin = req.headers?.origin || '';
    const base =
      /^https?:\/\//i.test(envFront) ? envFront :
      /^https?:\/\//i.test(reqOrigin) ? reqOrigin :
      'http://localhost:5173'; // 最後の砦（dev）

    const successUrl = `${base.replace(/\/+$/,'')}/mypage?success=1`;
    const cancelUrl  = `${base.replace(/\/+$/,'')}/posts/${postId}`;    

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
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { 
        userId: req.user.sub, 
        postId,
        creatorId: post.creatorId,
      },
    });

    return { sessionId: session.id, url: session.url };
  }

  @Post()
  @UseGuards(JwtAuthGuard) // ← 必須
  async create(@Req() req: any, @Body() dto: CreatePostDto) {
    const creatorId = await getMyCreatorId(this.prisma, req.user.sub);

    // 受け取り値を正規化
    const toPublishedStatus = (v: unknown): PublishedStatus => {
      if (typeof v === 'boolean') return v ? PublishedStatus.published : PublishedStatus.draft;
      if (typeof v === 'string') {
        const s = v.toLowerCase();
        if (s === 'published') return PublishedStatus.published;
        if (s === 'private')   return PublishedStatus.private;
        return PublishedStatus.draft;
      }
      return PublishedStatus.draft;
    };    

    const pub = toPublishedStatus((dto as any).publishedStatus ?? (dto as any).status);
    const pubAt = pub === PublishedStatus.published ? new Date() : null;

    return this.prisma.post.create({
      data: {
        title: dto.title,
        body: dto.body,
        visibility: dto.visibility,            // enum化していればキャスト
        ageRating: dto.ageRating,
        publishedStatus: pub,
        publishedAt: pubAt,
        creatorId,
        planId: dto.visibility === Visibility.plan ? dto.planId ?? null : null,
        priceJpy: dto.visibility === Visibility.paid_single ? dto.priceJpy ?? null : null,
      },
      select: { id: true },
    });
  }  
}
