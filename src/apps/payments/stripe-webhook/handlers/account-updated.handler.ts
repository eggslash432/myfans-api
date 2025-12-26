// api/src/apps/payments/stripe-webhook/account-updated.handler.ts
import { Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../../../prisma/prisma.service'; 
import { KycStatus, NotificationSource, NotificationType } from '@prisma/client';
import { NotificationsService } from '../../../notifications/notifications.service';

@Injectable()
export class AccountUpdatedHandler {
  private readonly logger = new Logger(AccountUpdatedHandler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

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

    // 変更前状態を拾う（通知のスパム防止）
    const before = await this.prisma.creator.findFirst({
      where: { stripeAccountId },
      select: { userId: true, stripeKycStatus: true },
    });

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

    // ✅ 該当creatorが居ないなら終了
    if (!before?.userId || result.count === 0) {
      this.logger.log(
        `account.updated sync: acct=${stripeAccountId} updated=${result.count} (no creator matched)`,
      );
      return;
    }

    // ✅ ステータス変化がある時だけ通知
    if (before.stripeKycStatus !== stripeKycStatus) {
      const title =
        stripeKycStatus === KycStatus.approved
          ? '本人確認（KYC）が承認されました'
          : '本人確認（KYC）の確認が必要です';

      const body =
        stripeKycStatus === KycStatus.approved
          ? '出金・決済の機能が利用可能になりました。'
          : [
              'Stripe本人確認の追加対応が必要です。',
              disabledReason ? `理由: ${disabledReason}` : null,
              currentlyDue.length ? `不足項目: ${currentlyDue.join(', ')}` : null,
            ]
              .filter(Boolean)
              .join('\n');

      await this.notifications.notify({
        userId: before.userId,
        type: NotificationType.KYC,
        source: NotificationSource.WEBHOOK,
        title,
        body,
      });
    }

    this.logger.log(
      `account.updated sync: acct=${stripeAccountId} updated=${result.count} charges=${stripeChargesEnabled} payouts=${stripePayoutsEnabled} kyc=${stripeKycStatus}`,
    );
  }
}
