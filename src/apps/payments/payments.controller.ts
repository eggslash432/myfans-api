// payments.controller.ts
import { BadRequestException, Body, Controller, Post, Req } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';

class CreateCheckoutDto {
  planId?: string;   // サブスク用
  postId?: string;   // PPV用
  successUrl!: string;
  cancelUrl!: string;
}

@Controller('payments')
export class PaymentsController {
  private stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

  constructor(private readonly prisma: PrismaService) {}

  @Post('checkout/session')
  async createCheckout(@Req() req: any, @Body() dto: CreateCheckoutDto) {
    const userId = req.user?.id;
    if (!userId) throw new BadRequestException('Unauthenticated');
    if (!dto.planId && !dto.postId) throw new BadRequestException('planId or postId required');

    let priceId: string;
    let mode: 'payment' | 'subscription';

    if (dto.planId) {
      // ===== サブスク（planId）=====
      const plan = await this.prisma.plan.findUnique({ where: { id: dto.planId } });
      if (!plan) throw new BadRequestException('plan not found');

      // 既にStripeのPriceが紐づいていればそれを使用
      if (plan.externalPriceId) {
        priceId = plan.externalPriceId;
      } else {
        // なければ作成（Product + recurring Price）
        const product = await this.stripe.products.create({
          name: plan.name,
          metadata: { planId: plan.id },
        });
        const price = await this.stripe.prices.create({
          product: product.id,
          currency: 'jpy',
          unit_amount: plan.priceJpy * 100,
          recurring: { interval: 'month' }, // 月額
        });
        priceId = price.id;

        // できたPriceをDBに保存（externalPriceId を使う）
        await this.prisma.plan.update({
          where: { id: plan.id },
          data: { externalPriceId: priceId },
        });
      }
      mode = 'subscription';
    } else {
      // ===== PPV（postId）=====
      const post = await this.prisma.post.findUnique({ where: { id: dto.postId! } });
      if (!post?.priceJpy) throw new BadRequestException('ppv post/price not found');

      // 都度Price（固定額/単発）
      const price = await this.stripe.prices.create({
        currency: 'jpy',
        unit_amount: post.priceJpy * 100,
        product_data: { name: `PPV: ${post.title}`, metadata: { postId: post.id } },
      });
      priceId = price.id;
      mode = 'payment';
    }

    const session = await this.stripe.checkout.sessions.create({
      mode,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: dto.successUrl,
      cancel_url: dto.cancelUrl,
      metadata: {
        userId,
        planId: dto.planId ?? '',
        postId: dto.postId ?? '',
      },
    });

    return { id: session.id, url: session.url };
  }
}
