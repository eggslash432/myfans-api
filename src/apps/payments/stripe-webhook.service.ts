// src/apps/payments/stripe-webhook.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type Stripe from 'stripe';

@Injectable()
export class StripeWebhookService {
  private readonly logger = new Logger(StripeWebhookService.name);

  constructor(private readonly prisma: PrismaService) {}

  async handleAccountUpdated(account: Stripe.Account) {
    const kyc = account.requirements;

    // Stripe側のKYCざっくり判定
    const status =
      kyc?.disabled_reason === null && (kyc?.currently_due?.length ?? 0) === 0
        ? 'verified'   // 本人確認OK
        : 'pending';   // それ以外（書類不足・審査中など）

    // このアカウントIDに紐づくCreatorを更新
    await this.prisma.creator.updateMany({
      where: { stripeAccountId: account.id },
      data: { stripeKycStatus: status },   // ★ 追加したフィールドを更新
    });

    this.logger.log(
      `Stripe account ${account.id} KYC updated -> ${status}`,
    );
  }
}
