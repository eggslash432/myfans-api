// payments.controller.ts
import {
  Body, Controller, Post, Req,
  BadRequestException, UseGuards, HttpCode
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import Stripe from 'stripe';
import { CreateCheckoutValidatedDto } from './dto/create-checkout.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('payments')
export class PaymentsController {
  private stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

  constructor(private readonly prisma: PrismaService) {}

  @Post('checkout/session')
  @UseGuards(JwtAuthGuard)
  async createCheckout(@Req() req: any, @Body() dto: CreateCheckoutValidatedDto) {
    // JWTのペイロード: { sub: 'userId', email, role, ... }
    const userId: string | undefined = req.user?.id ?? req.user?.sub;
    if (!userId) throw new BadRequestException('Unauthenticated');
    if (!dto.planId && !dto.postId) throw new BadRequestException('planId or postId required');

    let priceId: string;
    let mode: 'payment' | 'subscription';

    if (dto.planId) {
      // ===== サブスク（planId）=====
      const plan = await this.prisma.plan.findUnique({ where: { id: dto.planId } });
      if (!plan) throw new BadRequestException('plan not found');

      if (plan.externalPriceId) {
        priceId = plan.externalPriceId;
      } else {
        const product = await this.stripe.products.create({
          name: plan.name,
          metadata: { planId: plan.id },
        });
        const price = await this.stripe.prices.create({
          product: product.id,
          currency: 'jpy',
          unit_amount: plan.priceJpy * 100,
          recurring: { interval: 'month' },
        });
        priceId = price.id;
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
      metadata: { userId, planId: dto.planId ?? '', postId: dto.postId ?? '' },
    });

    return { id: session.id, url: session.url };
  }

  // ====== ② Stripe Webhook受信（これを追加） ======
  @Post('webhooks/stripe')
  @HttpCode(200)
  async handleStripeWebhook(@Req() req: any) {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const event = req.body; // 検収用に署名検証は省略（本番は要verify）
    console.log('✅ Webhook event received:', event.type);

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const metadata = session.metadata ?? {};
      const userId = metadata.userId;
      const planId = metadata.planId;
      const postId = metadata.postId;
      const mode = session.mode;

      if (mode === 'subscription' && planId) {
        // サブスク登録
        const existing = await this.prisma.subscription.findFirst({
          where: { externalSubscriptionId: session.subscription as string } as any,
        });
        if (existing) {
          await this.prisma.subscription.update({
            where: { id: existing.id },
            data: { status: 'active' },
          });
        } else {
          await this.prisma.subscription.create({
            data: {
              userId,
              planId,
              status: 'active',
              externalSubscriptionId: session.subscription as string,
            } as any,
          });
        }
      }

      if (mode === 'payment' && postId) {
        // PPV購入時のアクセス付与
        await this.prisma.postAccess.upsert({
          where: { userId_postId: { userId, postId } },
          update: {},
          create: { userId, postId },
        });
      }
    }

    return { received: true };
  }
}
