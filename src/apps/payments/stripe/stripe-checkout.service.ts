// api/src/apps/payments/stripe/stripe-checkout.service.ts

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'src/apps/prisma/prisma.service';
import Stripe from 'stripe';

@Injectable()
export class StripeCheckoutService {
  private readonly stripe: Stripe;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    const secret = this.config.get<string>('stripeSecretKey');
    if (!secret) throw new Error('stripeSecretKey is not set');
    this.stripe = new Stripe(secret);
  }

  async createCheckoutForPlan(
    userId: string,
    creatorId: string,
    planId: string,
    successUrl?: string,
    cancelUrl?: string,
  ) {
    const creator = await this.prisma.creator.findUnique({
      where: { userId: creatorId },
      select: { stripeAccountId: true, shopId: true },
    });
    if (!creator?.stripeAccountId) {
      throw new Error('Creator stripe account not found');
    }

    const plan = await this.prisma.plan.findUnique({
      where: { id: planId },
      select: {
        id: true,
        name: true,
        priceJpy: true,
        billingInterval: true,
        isActive: true,
        creatorId: true,
      },
    });
    if (!plan || !plan.isActive) {
      throw new Error('Plan not found or inactive');
    }

    const appOrigin =
      this.config.get<string>('appOrigin') ?? 'http://localhost:5173';

    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [
        {
          price_data: {
            currency: 'jpy',
            unit_amount: plan.priceJpy!,
            recurring: {
              interval: plan.billingInterval === 'year' ? 'year' : 'month',
            },
            product_data: { name: plan.name },
          },
          quantity: 1,
        },
      ],
      customer: await this.ensureStripeCustomer(userId),
      success_url:
        successUrl ??
        `${appOrigin}/payments/success?from=plan&planId=${plan.id}`,
      cancel_url:
        cancelUrl ??
        `${appOrigin}/payments/cancel?from=plan&planId=${plan.id}`,
      metadata: {
        userId,
        creatorId,
        planId,
        shopId: creator.shopId ?? '',
      },
      subscription_data: {
        metadata: {
          userId,
          creatorId,
          planId,
          shopId: creator.shopId ?? '',
        },
      },
    });

    return { url: session.url };
  }

  async createCheckoutForPost(
    userId: string,
    postId: string,
    successUrl?: string,
    cancelUrl?: string,
  ) {
    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      include: {
        creator: { select: { stripeAccountId: true, shopId: true } },
      },
    });
    if (!post?.priceJpy) throw new Error('PPV price not set');

    const appOrigin =
      this.config.get<string>('appOrigin') ?? 'http://localhost:5173';

    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'jpy',
            unit_amount: post.priceJpy,
            product_data: { name: post.title },
          },
          quantity: 1,
        },
      ],
      customer: await this.ensureStripeCustomer(userId),
      success_url: successUrl ?? `${appOrigin}/mypage?ppv=success`,
      cancel_url: cancelUrl ?? `${appOrigin}/mypage?ppv=cancel`,
      metadata: {
        userId,
        creatorId: post.creatorId,
        postId,
        shopId: post.creator?.shopId ?? '',
      },
      payment_intent_data: {
        metadata: {
          userId,
          creatorId: post.creatorId,
          postId,
          shopId: post.creator?.shopId ?? '',
        },
      },
    });

    return { url: session.url };
  }

  async ensureStripeCustomer(userId: string): Promise<string | undefined> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, stripeCustomerId: true },
    });

    if (!user) return undefined;
    if (user.stripeCustomerId) return user.stripeCustomerId;

    const customer = await this.stripe.customers.create({
      email: user.email ?? undefined,
      metadata: { userId },
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { stripeCustomerId: customer.id },
    });

    return customer.id;
  }
}

