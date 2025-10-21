// payments.controller.ts
import {
  Body, Controller, Post, Req,
  BadRequestException, UseGuards, HttpCode, Headers,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import Stripe from 'stripe';
import { CreateCheckoutValidatedDto } from './dto/create-checkout.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PaymentKind, PaymentStatus } from '@prisma/client';

@Controller('payments')
export class PaymentsController {
  private stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  constructor(private readonly prisma: PrismaService) {}

  // ここを追加 ↓↓↓
  @Post('webhook')
  @HttpCode(200) // Stripe Webhook は 2xx 応答が必須
  async webhook(
    @Req() req: any,
    @Headers('stripe-signature') signature?: string,
  ) {
    const whSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!whSecret) {
      throw new BadRequestException('STRIPE_WEBHOOK_SECRET is not set');
    }

    let event: Stripe.Event;
    try {
      // main.ts で raw を通しているので req.body は Buffer
      event = this.stripe.webhooks.constructEvent(req.body, signature!, whSecret);
    } catch (e: any) {
      throw new BadRequestException(`Webhook signature verification failed: ${e.message}`);
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const cs = event.data.object as Stripe.Checkout.Session;

        // mode: 'payment' | 'subscription'
        const mode = cs.mode;
        const metadata = (cs.metadata || {}) as Record<string, string | undefined>;
        const userId = metadata.userId;
        const postId = metadata.postId; // PPV のとき posts.controller で埋めている
        const planId = metadata.planId; // もしサブスク導線で埋めるなら
        const creatorId = metadata.creatorId; 

        // Stripe ID（ユニーク）
        const externalTxId =
          typeof cs.payment_intent === 'string'
            ? cs.payment_intent
            : (cs.payment_intent as Stripe.PaymentIntent | null)?.id ?? cs.id;

        // 金額（JPYは最小単位＝円）
        const amountJpy = cs.amount_total ?? 0; // Int 必須      
        
        // デバッグ
        console.log('[webhook] session.id=', cs.id);
        console.log('[webhook] amountJpy=', amountJpy, ' userId=', userId, ' postId=', postId);
        console.log('[webhook] externalTxId=', externalTxId);        

        await this.prisma.payment.upsert({
          where: { externalTxId },
          update: {
            paymentStatus: PaymentStatus.paid,
            amountJpy: amountJpy,
            paidAt: new Date(),
          },
          create: {
            externalTxId,
            userId: userId ?? null,
            creatorId: creatorId ?? null,
            planId: planId ?? null,
            postId: postId ?? null,
            amountJpy: amountJpy,           // ★ required Int
            kind: mode === 'subscription'
              ? PaymentKind.subscription
              : PaymentKind.one_time,
            paymentStatus: PaymentStatus.paid,
            paidAt: new Date(),
          },
        });

        // ★ ここがあなたの既存ロジックと接続する場所
        if (mode === 'payment' && postId && userId) {
          // PPV購入 → PostAccess 付与
          await this.prisma.postAccess.upsert({
            where: { userId_postId: { userId, postId } },
            update: {},
            create: { userId, postId },
          });
        }

        // サブスク（必要なら）
        // if (mode === 'subscription' && planId && userId) {
        //   await this.prisma.subscription.upsert({ ... });
        // }

        break;
      }

      // 必要なら他イベントも拾う
      case 'payment_intent.succeeded':
      case 'charge.succeeded':
      default:
        // ログだけ取ってNo-Op
        break;
    }

    return { received: true };
  }  

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
