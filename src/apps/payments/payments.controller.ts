import 'dotenv/config';
import {
  Controller,
  Post,
  Req,
  HttpCode,
  Headers,
  BadRequestException,
} from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('webhooks/stripe')
  @HttpCode(200)
  async handleStripeWebhook(
    @Req() req: any,
    @Headers('stripe-signature') sig: string,
  ) {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(
        req.rawBody,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET!,
      );
    } catch (err: any) {
      console.error('❌ Webhook verify failed', err.message);
      throw new BadRequestException(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const metadata = session.metadata ?? {};
      const postId = metadata.postId;
      const userId = metadata.userId;

      const amount = (session.amount_total ?? 0) / 100;
      const externalTxId = session.id; // ← フィールド名を externalTxId に統一

      // DBへ保存
      await this.prisma.payment.upsert({
        where: { externalTxId }, // ← フィールド名修正
        update: {},
        create: {
          userId,
          postId,
          amountJpy: amount,
          status: 'paid',
          externalTxId,          // ← 修正済み
          paidAt: new Date(),
          kind: 'one_time',
        },
      });

      // 投稿アクセス権付与
      if (postId && userId) {
        await this.prisma.postAccess.upsert({
          where: { userId_postId: { userId, postId } },
          update: {},
          create: { userId, postId },
        });
      }

      console.log(`✅ Payment saved & access granted: user=${userId}, post=${postId}`);
    }

    return { received: true };
  }
}
