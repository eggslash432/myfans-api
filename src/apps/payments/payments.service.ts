import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/apps/prisma/prisma.service';
import Stripe from 'stripe';

@Injectable()
export class PaymentsService {
  private stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

  constructor(private prisma: PrismaService) {}

  async handleWebhook(body: any, signature?: string) {
    const evt = typeof body === 'string' ? JSON.parse(body) : body;

    const exists = await this.prisma.webhookLog.findUnique({ where: { id: evt.id } });
    if (exists) return { ok: true, duplicated: true };

    await this.prisma.$transaction(async (tx) => {
      await tx.webhookLog.create({ data: { id: evt.id, type: evt.type } });

      if (evt.type === 'checkout.session.completed') {
        const s = evt.data.object as any;

        const userId = String(s.metadata?.userId);
        const planId = String(s.metadata?.planId);
        const externalSubId = s.subscription ? String(s.subscription) : null;

        // --- 期間境界を先に決定（Stripeから取得、なければフォールバック） ---
        let periodStart = new Date();
        let periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // +30日(暫定)

        if (externalSubId) {
          try {
            // 取得
            const subRes = await this.stripe.subscriptions.retrieve(externalSubId);

            // ★ any で snake_case を直接読む（SDK 実値は snake_case）
            const cps: number | undefined = (subRes as any)?.current_period_start;
            const cpe: number | undefined = (subRes as any)?.current_period_end;

            // 以降は通常どおりアクセス可能
            if (typeof cps === 'number') {
              periodStart = new Date(cps * 1000);
            }
            if (typeof cpe === 'number') {
              periodEnd = new Date(cpe * 1000);
            }
          } catch (e) {
            // 取得失敗時はフォールバック値のまま続行
          }
        }

        // --- 既存購読の有無で分岐 ---
        const existing = await tx.subscription.findFirst({
          where: { userId, planId },
        });

        if (existing) {
          await tx.subscription.update({
            where: { id: existing.id },
            data: {
              status: 'active',
              externalSubId,
              currentPeriodStart: periodStart,
              currentPeriodEnd: periodEnd,     // ★ 必須フィールドをセット
            },
          });
        } else {
          await tx.subscription.create({
            data: {
              userId,                          // string
              planId,                          // string
              status: 'active',
              externalSubId,
              currentPeriodStart: periodStart, // ★ 必須
              currentPeriodEnd: periodEnd,     // ★ 必須
              // cancelAtPeriodEnd: false,     // 必要なら併用
            },
          });
        }
      }
    });

    return { ok: true };
  }


}
