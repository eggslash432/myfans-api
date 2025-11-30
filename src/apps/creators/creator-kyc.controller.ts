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
import { UserJwt } from 'src/shared/types';

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
    try {
      const user = req.user as UserJwt | undefined;
      const userId = user?.id;
      if (!userId) throw new BadRequestException('Unauthenticated');

      const creatorId = await this.creatorHelper.getMyCreatorId(userId);

      const creator = await this.prisma.creator.findUnique({
        where: { userId: creatorId },
        select: {
          userId: true,
          publicName: true,
          stripeAccountId: true,
        },
      });
      if (!creator) {
        throw new BadRequestException('creator not found');
      }

      let accountId = creator.stripeAccountId;
      if (!accountId) {
        const acct = await this.stripe.accounts.create({
          type: 'express',
          country: 'JP',
          email: user?.email,
          business_type: 'individual',
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
          },
          metadata: { userId, creatorId },
        });

        accountId = acct.id;

        await this.prisma.creator.update({
          where: { userId: creatorId },
          data: {
            stripeAccountId: accountId,
            stripeKycStatus: 'pending',
          },
        });
      }

      const refreshUrl = `${this.appOrigin}/creator/settings?kyc=refresh`;
      const returnUrl = `${this.appOrigin}/creator/settings?kyc=return`;

      const link = await this.stripe.accountLinks.create({
        account: accountId,
        refresh_url: refreshUrl,
        return_url: returnUrl,
        type: 'account_onboarding',
      });

      return { url: link.url };
    } catch (err: any) {
      console.error('Stripe KYC error:', err, err?.raw);
      const msg =
        err?.raw?.message ??
        err?.message ??
        'Stripe KYC start failed';
      throw new BadRequestException(msg);
    }
  }
}
