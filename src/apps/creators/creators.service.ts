// myfans-api/src/apps/creators/creators.service.ts

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCreatorDto } from './dto/create-creator.dto';
import { KycStatus, Role } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

@Injectable()
export class CreatorsService {
  private stripe: Stripe;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    const key = this.config.get<string>('STRIPE_SECRET_KEY');
    if (!key) {
      throw new Error('STRIPE_SECRET_KEY is not set');
    }
    this.stripe = new Stripe(key);
  }

  async applyCreator(userIdRaw: string, dto: CreateCreatorDto) {
    const userId = userIdRaw;

    if (!userId || typeof userId !== 'string') {
      throw new BadRequestException('invalid user id: ' + userIdRaw);
    }

    // ユーザーが実在するか一応チェック
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new BadRequestException('user not found: ' + userId);
    }

    // publicName を決定
    const publicName =
      dto.publicName ??
      dto.displayName ??
      user.email?.split('@')[0];

    if (!publicName) {
      throw new BadRequestException(
        'publicName または displayName を指定してください',
      );
    }

    // Creator があれば更新、なければ新規作成
    const creator = await this.prisma.creator.upsert({
      where: { userId }, // PK = userId
      update: {
        publicName,
        bankAccount: dto.bankAccount ?? undefined,
      },
      create: {
        userId,
        publicName,
        bankAccount: dto.bankAccount ?? undefined,
      },
    });

    // ユーザーの role を creator に（ここだけで十分）
    if (user.role !== Role.creator) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { role: Role.creator },
      });
    }

    return creator;
  }

  async getCreator(userId: string) {
    const creator = await this.prisma.creator.findUnique({
      where: { userId },
      select: {
        userId: true,
        publicName: true,
        stripeAccountId: true,
        stripeKycStatus: true,
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
        stripeKycDisabledReason: true,
        stripeKycErrors: true,
        stripeKycFieldsDue: true,
        isListed: true,
      },
    });

    return {
      ...creator,
      kyc: {
        status: creator?.stripeKycStatus,
        chargesEnabled: creator?.stripeChargesEnabled,
        payoutsEnabled: creator?.stripePayoutsEnabled,
        disabledReason: creator?.stripeKycDisabledReason,
        errors: creator?.stripeKycErrors,
        fieldsDue: creator?.stripeKycFieldsDue,
      },
    };
  }  

  async createSubscriptionCheckout(creatorId: string, planId: string) {
    const plan = await this.prisma.plan.findUnique({ where: { id: planId } });
    if (!plan || plan.creatorId !== creatorId) throw new NotFoundException('Plan not found');

    const priceId = plan.externalPriceId; // ← Prismaの型に存在するフィールド名
    if (!priceId) throw new NotFoundException('externalPriceId (Stripe price) missing');

    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      success_url: `${process.env.APP_ORIGIN}/mypage?result=success`,
      cancel_url: `${process.env.APP_ORIGIN}/creator/${creatorId}/plans?cancelled=1`,
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: undefined, // 既存Customerに紐付けるなら customer を指定
      // customer: 'cus_xxx',
      metadata: { creatorId, planId },
    });

    return session.url!; // これをフロントへ返す
  }

  async createStripeAccountForCreator(userId: string) {
    const account = await this.stripe.accounts.create({
      type: 'express',
      country: 'JP',
      business_type: 'individual',
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    });

    await this.prisma.creator.update({
      where: { userId },
      data: { stripeAccountId: account.id },
    });

    return account.id;
  }  

  async createKycLink(stripeAccountId: string) {
    const link = await this.stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: process.env.FRONTEND_URL + "/kyc/refresh",
      return_url: process.env.FRONTEND_URL + "/kyc/complete",
      type: "account_onboarding",
    });
    return link.url;
  }  

  // クリエイター情報 + KYCステータス取得
  async getMe(userId: string) {
    const creator = await this.prisma.creator.findUnique({
      where: { userId },
    });
    console.log('getMe userId =', userId, 'creator =', creator);
    if (!creator) {
      // ★ 未登録なら 404 を返す
      throw new NotFoundException('creator not found');
    }
    return creator;
  }

  // KYC開始用（アカウントを作ってリンク返す）
  async startKyc(userId: string) {
    // 1. Creator を取得
    const creator = await this.prisma.creator.findUnique({ where: { userId } });
    if (!creator) {
      throw new BadRequestException('クリエイター登録が必要です');
    }

    // 2. Stripeアカウントが無ければ作成
    const accountId =
      creator.stripeAccountId ??
      (await this.createStripeAccountForCreator(userId));

    // 3. KYCリンクを作成
    const url = await this.createKycLink(accountId);

    return { url, stripeKycStatus: creator.stripeKycStatus ?? 'pending' };
  }  
}
