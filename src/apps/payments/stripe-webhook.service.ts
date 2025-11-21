// src/apps/payments/stripe-webhook.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type Stripe from 'stripe';

@Injectable()
export class StripeWebhookService {
  private readonly logger = new Logger(StripeWebhookService.name);

  constructor(private readonly prisma: PrismaService) {}

  async handleAccountUpdated(account: Stripe.Account) {
    const req = account.requirements;
    const disabled = req?.disabled_reason;
    const errors = req?.errors ?? [];
    const currentlyDue = req?.currently_due ?? [];
    const pendingVerification = req?.pending_verification ?? [];

    // ①ステータス判定ロジック
    let status: 'verified' | 'pending' | 'reviewing' | 'rejected' | 'disabled';

    if (disabled) {
      status = 'disabled';
    } else if (errors.length > 0) {
      status = 'rejected';
    } else if (currentlyDue.length > 0) {
      status = 'pending'; // 書類不足
    } else if (pendingVerification.length > 0) {
      status = 'reviewing'; // Stripe 審査中
    } else {
      status = 'verified'; // 完全承認
    }

    // ② DB 更新（必要項目すべて）
    await this.prisma.creator.updateMany({
      where: { stripeAccountId: account.id },
      data: {
        stripeKycStatus: status,
        stripeChargesEnabled: account.charges_enabled,
        stripePayoutsEnabled: account.payouts_enabled,
        stripeKycDisabledReason: disabled,
        stripeKycErrors: JSON.stringify(errors),
        stripeKycFieldsDue: JSON.stringify(currentlyDue),
      },
    });

    this.logger.log(
      `Stripe KYC updated for ${account.id} -> ${status}`,
    );
  }
}
