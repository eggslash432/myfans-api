// payments.controller.ts
import {
  Body, Controller, Post, Req,
  BadRequestException, UseGuards, HttpCode, Headers,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import Stripe from 'stripe';
import { CreateCheckoutValidatedDto } from './dto/create-checkout.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CheckoutMode, PaymentKind, PaymentStatus } from '@prisma/client';


// 🧩 この関数を追加
function mapStripeStatus(
  s: string
): 'active' | 'trialing' | 'past_due' | 'canceled' | 'incomplete' {
  if (s === 'active') return 'active';
  if (s === 'trialing') return 'trialing';
  if (s === 'past_due') return 'past_due';
  if (s === 'canceled') return 'canceled';
  return 'incomplete';
}

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
        const stripeSubscriptionId = cs.subscription as string | null;
        // 金額（JPYは最小単位＝円）
        const amountJpy = cs.amount_total ?? 0; // Int 必須 

        if (mode === 'subscription' && userId && planId && creatorId && stripeSubscriptionId) {
          // 期間境界は Stripe から取得（失敗時フォールバック +30日）
          let periodStart = new Date();
          let periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
          try {
            const sub = await this.stripe.subscriptions.retrieve(stripeSubscriptionId);
            const cps = (sub as any)?.current_period_start;
            const cpe = (sub as any)?.current_period_end;
            if (typeof cps === 'number') periodStart = new Date(cps * 1000);
            if (typeof cpe === 'number') periodEnd = new Date(cpe * 1000);
          } catch (e) {
            // ログだけ出してフォールバック
            console.warn(`[webhook] retrieve subscription failed: ${String((e as Error).message)}`);
          }

          // userId + creatorId + planId の複合ユニークで upsert
          await this.prisma.subscription.upsert({
            where: { userId_creatorId_planId: { userId, creatorId, planId } },
            create: {
              userId,
              creatorId,
              planId,
              status: 'active',
              stripeSubscriptionId: stripeSubscriptionId,
              currentPeriodStart: periodStart,
              currentPeriodEnd: periodEnd,
              cancelAtPeriodEnd: false,
            },
            update: {
              status: 'active',
              stripeSubscriptionId: stripeSubscriptionId, // 保険で最新値に
              currentPeriodStart: periodStart,
              currentPeriodEnd: periodEnd,
              cancelAtPeriodEnd: false,
            },
          });
        }

        // 既存の payment upsert / PPV 付与ロジックはそのままでOK
        // ★ ここがあなたの既存ロジックと接続する場所
        if (mode === CheckoutMode.payment && postId && userId) {
          // PPV購入 → PostAccess 付与
          await this.prisma.postAccess.upsert({
            where: { userId_postId: { userId, postId } },
            update: {},
            create: { userId, postId },
          });
        }

        break;
      }

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'invoice.paid': {
      // 正確な期間・状態で上書き
      const sub = event.data.object as Stripe.Subscription;
      const start = new Date((sub as any).current_period_start * 1000);
      const end   = new Date((sub as any).current_period_end * 1000);

      await this.prisma.subscription.updateMany({
        where: { stripeSubscriptionId: sub.id },
        data: {
          status: mapStripeStatus(sub.status),
          currentPeriodStart: start,
          currentPeriodEnd: end,
          cancelAtPeriodEnd: !!(sub as any).cancel_at_period_end,
        },
      });
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      await this.prisma.subscription.updateMany({
        where: { stripeSubscriptionId: sub.id },
        data: { status: 'canceled' },
      });
      break;
    }

    default:
      // 必要に応じてログ
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

  // サブスク(プラン)のCheckoutセッション作成
  @UseGuards(JwtAuthGuard)
  @Post('checkout/plan')
  async checkoutPlan(@Body() body: { planId: string }, @Req() req: any) {
    const userId = req.user?.sub;
    const planId = body?.planId;
    if (!userId || !planId) throw new BadRequestException('invalid request');

    const plan = await this.prisma.plan.findUnique({
      where: { id: planId },
      select: { id: true, name: true, priceJpy: true, isActive: true, creatorId: true },
    });
    if (!plan || !plan.isActive) throw new NotFoundException('plan not found');

    // 返りURL（.env の FRONT_URL を優先）
    const envFront = process.env.FRONT_URL || '';
    const reqOrigin = req.headers?.origin || '';
    const base =
      /^https?:\/\//i.test(envFront) ? envFront :
      /^https?:\/\//i.test(reqOrigin) ? reqOrigin :
      'http://localhost:5173';

    const successUrl = `${base.replace(/\/+$/,'')}/mypage?subscribed=1`;
    const cancelUrl  = `${base.replace(/\/+$/,'')}/creators/${plan.creatorId}`;

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

    // （簡易）毎回カスタマー作成。既存を再利用する設計ならここで検索/保存する
    const customer = await stripe.customers.create({
      email: req.user.email,
      metadata: { userId },
    });

    // JPYはゼロ小数。unit_amount はそのまま円で指定
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customer.id,
      line_items: [
        {
          price_data: {
            currency: 'jpy',
            recurring: { interval: 'month' },
            unit_amount: plan.priceJpy,
            product_data: { name: `Plan: ${plan.name}` },
          },
          quantity: 1,
        },
      ],
      allow_promotion_codes: true,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        kind: 'plan',
        userId,
        planId: plan.id,
        creatorId: plan.creatorId,
      },
    });

    return { sessionId: session.id, url: session.url };
  }  

  // @Post('webhook')
  // rawBody(@Req() req, @Headers('stripe-signature') sig: string) {
  //   let event: Stripe.Event;
  //   try {
  //     event = this.stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  //   } catch (err) { 
  //     const msg = err instanceof Error ? err.message : String(err);
  //     throw new BadRequestException(`Webhook Error: ${msg}`); 
  //   }

  //   if (event.type === 'checkout.session.completed') {
  //     const s = event.data.object as Stripe.Checkout.Session;
  //     if (s.mode === 'subscription' && s.metadata?.kind === 'plan') {

  //       const userId = s.metadata.userId!;
  //       const planId = s.metadata.planId!;
  //       const externalSubId = s.subscription as string;

  //       // とりあえず“今日開始・+30日”で作成（後で正確値に更新）
  //       const now = new Date();
  //       const approxEnd = new Date(now.getTime() + 30 * 24 * 3600 * 1000);        

  //       this.prisma.subscription.upsert({
  //         where: {
  //           userId_planId: { userId: userId, planId: planId },
  //         },
  //         create: {
  //           userId: userId,
  //           planId: planId,
  //           status: 'active',
  //           externalSubId,
  //           currentPeriodStart: now,
  //           currentPeriodEnd: approxEnd,
  //         },
  //         update: {
  //           status: 'active',
  //           externalSubId,
  //         },
  //       }).catch(console.error);
  //     }
  //   }

  //   if (event.type === 'invoice.paid' || event.type === 'customer.subscription.updated') {
  //     const sub = event.data.object as Stripe.Subscription;
  //     const start = new Date((sub as any).current_period_start * 1000);
  //     const end   = new Date((sub as any).current_period_end   * 1000);  

  //     this.prisma.subscription.updateMany({
  //       where: { externalSubId: sub.id },
  //       data: {
  //         status: mapStripeStatus(sub.status),
  //         currentPeriodStart: start,
  //         currentPeriodEnd: end,
  //         cancelAtPeriodEnd: !!(sub as any).cancel_at_period_end,
  //       },
  //     }).catch(console.error);
  //   }

  //   // 3) キャンセル/失効にも対応しておくと安心
  //   if (event.type === 'customer.subscription.deleted') {
  //     const sub = event.data.object as Stripe.Subscription;
  //     this.prisma.subscription.updateMany({
  //       where: { externalSubId: sub.id },
  //       data: { status: 'canceled' },
  //     }).catch(console.error);
  //   }

  //   return { received: true };    
  // }  

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
