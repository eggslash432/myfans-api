import 'dotenv/config';
import { Controller, Post, Req, Res, HttpCode } from '@nestjs/common';
import type { Request, Response } from 'express';
import Stripe from 'stripe';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

@Controller('payments')
export class PaymentsController {
  @Post('webhook')
  @HttpCode(200)
  async webhook(@Req() req: Request, @Res() res: Response) {
    try {
      // -- 1) raw body を常に取得（main.ts で express.raw を設定済み前提）
      const raw = (req as any).rawBody ?? (req as any).body;

      // -- 2) イベント構築（署名が揃えば検証、なければ手動 parse）
      let event: Stripe.Event | any;
      const sig = req.headers['stripe-signature'] as string | undefined;

      if (stripe && process.env.STRIPE_WEBHOOK_SECRET && sig) {
        event = stripe.webhooks.constructEvent(
          raw,
          sig,
          process.env.STRIPE_WEBHOOK_SECRET
        );
      } else {
        const text =
          Buffer.isBuffer(raw) ? raw.toString('utf8')
          : typeof raw === 'string' ? raw
          : JSON.stringify(raw ?? {});
        event = JSON.parse(text);
      }

      // -- 3) 受信ログ（開発用）
      console.log('[webhook] type=', event?.type);

      // -- 4) 取り出し（イベント毎に metadata / amount の在り処が違う）
      const obj: any = event?.data?.object ?? {};
      const md = obj.metadata ?? {};                   // charge/payment_intent/checkout_session 全部ここに居ることが多い

      // metadata のキー違いに広く対応
      const userId = md.userId || md.user_id || md.uid || md.viewerId;
      const postId = md.postId || md.ppvPostId || md.contentId || md.pid;

      // 金額（最小単位→円）。イベントによって項目が違うので広く拾う
      const minor =
        obj.amount ??
        obj.amount_total ??
        obj.amount_captured ??
        obj.amount_received ??
        obj.amount_due ??
        0;
      const amountJpyFromEvent = Math.max(0, Math.floor(Number(minor) / 100));

      // -- 5) PPV想定イベントのみ処理
      const isPpvEvent =
        event?.type === 'charge.succeeded' ||
        event?.type === 'payment_intent.succeeded' ||
        event?.type === 'checkout.session.completed';

      if (isPpvEvent && userId && postId) {
        const post = await prisma.post.findUnique({ where: { id: postId } });
        if (!post) {
          console.warn('[webhook] post not found:', { postId });
        } else {
          // paid_single 以外ならワーニング
          if (post.visibility !== 'paid_single') {
            console.warn('[webhook] post.visibility != paid_single:', post.visibility);
          }
          const amountJpy = amountJpyFromEvent || post.priceJpy || 0;

          // externalTxId は重複防止用（charge.id/intent.idが最優先）
          const extId =
            obj.id ||
            obj.charge ||
            obj.payment_intent ||
            `${event.id}:${postId}:${userId}`;

          await prisma.payment.upsert({
            where: { externalTxId: extId }, // Payment.externalTxId は @unique
            update: { status: 'paid', paidAt: new Date() },
            create: {
              userId,
              creatorId: post.creatorId, // = Creator.userId
              postId,
              amountJpy,
              kind: 'one_time',
              status: 'paid',
              externalTxId: extId,
              paidAt: new Date(),
            },
          });

          console.log('[webhook] Payment upserted:', { userId, postId, amountJpy, extId });
        }
      } else {
        console.log('[webhook] skipped:', { hasUserId: !!userId, hasPostId: !!postId, type: event?.type });
      }

      return res.send({ ok: true });
    } catch (e) {
      console.error('[stripe webhook error]', e);
      // 200で返す（Stripeは2xx以外で再送するため、開発中は 200 にしておく）
      return res.status(200).send({ ok: false });
    }
  }
}
