// src/apps/creators/creator-kyc.controller.ts

import {
  BadRequestException,
  Controller,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CreatorHelper } from '../helpers/creator.helper';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

type UserJwt = {
  sub: string;
  email?: string;
  role: 'fan' | 'creator' | 'admin';
};

@Controller('creators/me/kyc')
@UseGuards(JwtAuthGuard)
export class CreatorKycController {
  private readonly stripe: Stripe;
  private readonly appOrigin: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly creatorHelper: CreatorHelper,
    private readonly config: ConfigService,
  ) {
    const secret =
      process.env.STRIPE_SECRET_KEY ||
      this.config.get<string>('stripeSecretKey');
    if (!secret) {
      throw new Error('STRIPE_SECRET_KEY is not set');
    }
    this.stripe = new Stripe(secret, {    });

    // 戻り先URLのベース（フロントURL）
    const front =
      process.env.FRONT_URL ||
      this.config.get<string>('frontUrl') ||
      'http://localhost:5173';
    this.appOrigin = front.replace(/\/+$/, '');
  }

  /**
   * POST /api/creators/me/kyc/start
   *
   * settings.tsx の api.startCreatorKyc() から呼ばれる想定。
   * - Creator 用の Stripe Connect Account を作成 or 取得
   * - account_onboarding のための account_link を作成
   * - { url } を返してフロント側で window.location.href = url
   */
  @Post('start')
  async startKyc(@Req() req: any) {
    const user = req.user as UserJwt | undefined;
    const userId = user?.sub ?? (req.user?.id as string | undefined);
    if (!userId) throw new BadRequestException('Unauthenticated');

    // Creator であることを確認（そうでなければ Forbidden）
    const creatorId = await this.creatorHelper.getMyCreatorId(userId);

    // Creator レコード取得（Stripe関連フィールドも見る）
    const creator = await this.prisma.creator.findUnique({
      where: { userId: creatorId },
      select: {
        userId: true,
        publicName: true,
        stripeAccountId: true,
      },
    });
    if (!creator) {
      // settings.tsx が "creator not found" を特別扱いしているので合わせる
      throw new BadRequestException('creator not found');
    }

    // 既存の Stripe Connect Account を使うか、なければ作成
    let accountId = creator.stripeAccountId;
    if (!accountId) {
      const acct = await this.stripe.accounts.create({
        // Express アカウント前提（必要に応じて custom に変更）
        type: 'express',
        country: 'JP',
        email: user?.email,
        business_type: 'individual',
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        metadata: {
          userId,
          creatorId,
        },
      });

      accountId = acct.id;

      await this.prisma.creator.update({
        where: { userId: creatorId },
        data: {
          stripeAccountId: accountId,
          // KYC 開始時点では pending 扱い
          stripeKycStatus: 'pending',
        },
      });
    }

    // 本人確認画面のURL（Stripe Connect Onboarding）を作成
    const refreshUrl = `${this.appOrigin}/creator/settings?kyc=refresh`;
    const returnUrl = `${this.appOrigin}/creator/settings?kyc=return`;

    const link = await this.stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: 'account_onboarding',
    });

    // フロントからは { url } を受けて location.href で遷移させる
    return { url: link.url };
  }
}
