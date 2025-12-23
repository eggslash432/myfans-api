// api/src/apps/payments/stripe-webhook/account-updated.handler.ts
import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../../prisma/prisma.service';
import { KycStatus } from '@prisma/client';

@Injectable()
export class AccountUpdatedHandler {
  private readonly logger = new Logger(AccountUpdatedHandler.name);

  constructor(private readonly prisma: PrismaService) {}

  // ✅ Connect口座の状態を Creator に同期
  async handle(account: Stripe.Account) {
    const stripeAccountId = account.id;

    const stripeChargesEnabled = !!account.charges_enabled;
    const stripePayoutsEnabled = !!account.payouts_enabled;

    const disabledReason = account.requirements?.disabled_reason ?? null;
    const currentlyDue = account.requirements?.currently_due ?? [];

    const stripeKycStatus: KycStatus =
      stripeChargesEnabled && stripePayoutsEnabled
        ? KycStatus.approved
        : KycStatus.pending;

    const result = await this.prisma.creator.updateMany({
      where: { stripeAccountId },
      data: {
        stripeChargesEnabled,
        stripePayoutsEnabled,
        stripeKycStatus,
        stripeKycDisabledReason: disabledReason,
        stripeKycFieldsDue: currentlyDue.join(','),
        updatedAt: new Date(),
      },
    });

    this.logger.log(
      `account.updated sync: acct=${stripeAccountId} updated=${result.count} charges=${stripeChargesEnabled} payouts=${stripePayoutsEnabled} kyc=${stripeKycStatus}`,
    );
  }
}
