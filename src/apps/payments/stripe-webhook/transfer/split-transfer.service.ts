// api/src/apps/payments/stripe-webhook/split-transfer.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { TransferKind } from '@prisma/client';

import { FeeSettingLike, makeEffectiveFeeSetting, splitByFeeSetting } from './split-calculator';
import { TransferLedgerService } from './transfer-ledger.service';
import { StripeTransferService } from './stripe-transfer.service';

@Injectable()
export class SplitTransferService {
  private readonly logger = new Logger(SplitTransferService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: TransferLedgerService,
    private readonly stripeTransfer: StripeTransferService,
  ) {}

  private async getFeeSettingSafe(): Promise<FeeSettingLike> {
    const fs = await this.prisma.feeSetting.findFirst();
    return (
      fs ?? {
        id: 1,
        managerPercent: 20,
        shopPercent: 10,
        creatorPercent: 70,
        updatedAt: new Date(),
      }
    );
  }

  async createSplitTransfers(params: {
    paymentId: string;
    externalTxId: string;
    amountJpy: number;
    creatorUserId: string;
    shopId?: string | null;
    chargeId?: string | null;
  }) {
    const { paymentId, externalTxId, amountJpy, creatorUserId, shopId, chargeId } = params;

    const feeSetting = await this.getFeeSettingSafe();
    const effectiveSetting = makeEffectiveFeeSetting(feeSetting, shopId);
    const split = splitByFeeSetting(amountJpy, effectiveSetting);

    // Paymentスナップショット
    await this.prisma.payment.update({
      where: { id: paymentId },
      data: {
        managerPercent: effectiveSetting.managerPercent ?? null,
        shopPercent: effectiveSetting.shopPercent ?? null,
        creatorPercent: effectiveSetting.creatorPercent ?? null,
        platformAmountJpy: split.managerAmountJpy,
        shopAmountJpy: split.shopAmountJpy,
        creatorAmountJpy: split.creatorAmountJpy,
      },
    });

    // platform(local)
    if (split.managerAmountJpy > 0) {
      await this.ledger.upsertLocal({
        paymentId,
        kind: TransferKind.platform,
        amountJpy: split.managerAmountJpy,
        destinationAcct: 'platform',
        stripeTransferId: `local_${externalTxId}_platform`,
      });
    }

    // creator
    const creator = await this.prisma.creator.findUnique({
      where: { userId: creatorUserId },
      select: { id: true, stripeAccountId: true },
    });
    const localCreatorKey = `local_${externalTxId}_creator`;

    if (!creator?.stripeAccountId) {
      if (split.creatorAmountJpy > 0) {
        await this.ledger.upsertLocal({
          paymentId,
          kind: TransferKind.creator,
          amountJpy: split.creatorAmountJpy,
          destinationAcct: 'unlinked_creator',
          stripeTransferId: localCreatorKey,
        });
      }
    } else if (split.creatorAmountJpy > 0) {
      try {
        const tr = await this.stripeTransfer.createTransfer({
          amountJpy: split.creatorAmountJpy,
          destination: creator.stripeAccountId,
          transferGroup: externalTxId,
          chargeId,
          idempotencyKey: `tr_${externalTxId}_creator`,
          metadata: {
            kind: 'creator',
            creatorUserId,
            creatorInternalId: creator.id,
            shopId: shopId ?? '',
          },
        });

        await this.ledger.mergeLocalToStripe({
          paymentId,
          kind: TransferKind.creator,
          stripeTransferId: tr.id,
          destinationAcct: creator.stripeAccountId,
          amountJpy: split.creatorAmountJpy,
          localStripeTransferId: localCreatorKey,
        });
      } catch (e: any) {
        this.logger.error(
          `stripe transfer failed (creator): paymentId=${paymentId} externalTxId=${externalTxId} amount=${split.creatorAmountJpy} creatorUserId=${creatorUserId} shopId=${shopId ?? ''}`,
          e?.stack ?? String(e),
        );
        await this.ledger.upsertLocal({
          paymentId,
          kind: TransferKind.creator,
          amountJpy: split.creatorAmountJpy,
          destinationAcct: 'transfer_failed_creator',
          stripeTransferId: localCreatorKey,
        });
      }
    }

    // shop
    if (shopId && split.shopAmountJpy > 0) {
      const shop = await this.prisma.shop.findUnique({
        where: { id: shopId },
        select: { stripeAccountId: true },
      });
      const localShopKey = `local_${externalTxId}_shop`;

      if (!shop?.stripeAccountId) {
        await this.ledger.upsertLocal({
          paymentId,
          kind: TransferKind.shop,
          amountJpy: split.shopAmountJpy,
          destinationAcct: 'unlinked_shop',
          stripeTransferId: localShopKey,
          shopId,
        });
        this.logger.warn(
          `shop transfer ledger created (stripeAccountId missing): paymentId=${paymentId} shopId=${shopId}`,
        );
        return;
      }

      try {
        const tr = await this.stripeTransfer.createTransfer({
          amountJpy: split.shopAmountJpy,
          destination: shop.stripeAccountId,
          transferGroup: externalTxId,
          chargeId,
          idempotencyKey: `tr_${externalTxId}_shop`,
          metadata: { kind: 'shop', creatorUserId, shopId },
        });

        await this.ledger.mergeLocalToStripe({
          paymentId,
          kind: TransferKind.shop,
          shopId,
          stripeTransferId: tr.id,
          destinationAcct: shop.stripeAccountId,
          amountJpy: split.shopAmountJpy,
          localStripeTransferId: localShopKey,
        });
      } catch (e: any) {
        this.logger.error(
          `stripe transfer failed (shop): paymentId=${paymentId} externalTxId=${externalTxId} amount=${split.shopAmountJpy} shopId=${shopId}`,
          e?.stack ?? String(e),
        );
        await this.ledger.upsertLocal({
          paymentId,
          kind: TransferKind.shop,
          amountJpy: split.shopAmountJpy,
          destinationAcct: 'transfer_failed_shop',
          stripeTransferId: localShopKey,
          shopId,
        });
      }
    }
  }
}
