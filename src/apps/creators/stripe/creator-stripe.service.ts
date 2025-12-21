// api/src/apps/creators/stripe/creator-stripe.service.ts

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StripeClientProvider } from './stripe-client.provider';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class CreatorStripeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stripeProvider: StripeClientProvider,
    private readonly config: ConfigService,
  ) {}

  private stripe() {
    return this.stripeProvider.stripe;
  }

  private frontendOrigin() {
    return (
      process.env.APP_ORIGIN ||
      process.env.FRONTEND_URL ||
      this.config.get<string>('APP_ORIGIN') ||
      this.config.get<string>('FRONTEND_URL') ||
      'http://localhost:5173'
    );
  }

  async createStripeAccountForCreator(userId: string) {
    const account = await this.stripe().accounts.create({
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
    const origin = this.frontendOrigin();

    const link = await this.stripe().accountLinks.create({
      account: stripeAccountId,
      refresh_url: `${origin}/creator/payouts?kyc=refresh`,
      return_url: `${origin}/creator/payouts?kyc=complete`,
      type: 'account_onboarding',
    });

    return link.url;
  }

  async startKyc(userId: string) {
    const creator = await this.prisma.creator.findUnique({ where: { userId } });
    if (!creator) throw new BadRequestException('クリエイター登録が必要です');

    const accountId =
      creator.stripeAccountId ?? (await this.createStripeAccountForCreator(userId));

    const url = await this.createKycLink(accountId);
    return { url, stripeKycStatus: creator.stripeKycStatus ?? 'pending' };
  }

  async createSubscriptionCheckout(creatorId: string, planId: string) {
    const plan = await this.prisma.plan.findUnique({ where: { id: planId } });
    if (!plan || plan.creatorId !== creatorId) {
      throw new NotFoundException('Plan not found');
    }

    const creator = await this.prisma.creator.findUnique({
      where: { userId: creatorId },
    });
    if (!creator?.stripeAccountId) {
      throw new BadRequestException('Stripe account not linked for creator');
    }

    const priceId = plan.externalPriceId;
    if (!priceId) throw new NotFoundException('externalPriceId (Stripe price) missing');

    const origin =
      process.env.APP_ORIGIN ||
      process.env.FRONTEND_URL ||
      this.config.get<string>('APP_ORIGIN') ||
      'http://localhost:5173';

    const session = await this.stripe().checkout.sessions.create(
      {
        mode: 'subscription',
        success_url: `${origin}/mypage?result=success`,
        cancel_url: `${origin}/creators/${creatorId}?cancelled=1`,
        line_items: [{ price: priceId, quantity: 1 }],
        metadata: { creatorId, planId },
      },
      { stripeAccount: creator.stripeAccountId },
    );

    return session.url!;
  }
}
