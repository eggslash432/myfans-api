// api/src/apps/payments/stripe-webhook/split-transfer.service.ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../../prisma/prisma.service';
import { TransferKind } from '@prisma/client';
import { STRIPE_CLIENT } from './stripe-client.provider';

@Injectable()
export class SplitTransferService {
  private readonly logger = new Logger(SplitTransferService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
  ) {}

  private async getFeeSettingSafe() {
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

  private splitByFeeSetting(totalJpy: number, setting: any) {
    const manager = Math.floor((totalJpy * (setting.managerPercent ?? 0)) / 100);
    const shop = Math.floor((totalJpy * (setting.shopPercent ?? 0)) / 100);
    const creator = totalJpy - manager - shop;
    return { managerAmountJpy: manager, shopAmountJpy: shop, creatorAmountJpy: creator };
  }

  async createSplitTransfers(params: {
    paymentId: string;
    externalTxId: string;
    amountJpy: number;
    creatorId: string;
    shopId?: string | null;
    chargeId?: string | null;
  }) {
    const { paymentId, externalTxId, amountJpy, creatorId, shopId, chargeId } = params;

    const feeSetting = await this.getFeeSettingSafe();
    const split = this.splitByFeeSetting(amountJpy, feeSetting);

    // platform 台帳
    if ((split.managerAmountJpy ?? 0) > 0) {
      await this.prisma.transfer.upsert({
        where: { stripeTransferId: `local_${externalTxId}_platform` },
        update: { paymentId, kind: TransferKind.platform, amountJpy: split.managerAmountJpy, destinationAcct: 'platform' },
        create: { paymentId, kind: TransferKind.platform, amountJpy: split.managerAmountJpy, destinationAcct: 'platform', stripeTransferId: `local_${externalTxId}_platform` },
      });
    }

    // creator：送金できなければ台帳だけ
    const creator = await this.prisma.creator.findUnique({
      where: { userId: creatorId },
      select: { stripeAccountId: true },
    });

    if (!creator?.stripeAccountId) {
      if (split.creatorAmountJpy > 0) {
        await this.prisma.transfer.upsert({
          where: { stripeTransferId: `local_${externalTxId}_creator` },
          update: { paymentId, kind: TransferKind.creator, amountJpy: split.creatorAmountJpy, destinationAcct: 'unlinked_creator' },
          create: { paymentId, kind: TransferKind.creator, amountJpy: split.creatorAmountJpy, destinationAcct: 'unlinked_creator', stripeTransferId: `local_${externalTxId}_creator` },
        });
      }
    } else {
      if (split.creatorAmountJpy > 0) {
        const tr = await this.stripe.transfers.create(
          {
            amount: split.creatorAmountJpy,
            currency: 'jpy',
            destination: creator.stripeAccountId,
            transfer_group: externalTxId,
            source_transaction: chargeId ?? undefined,
            metadata: { kind: 'creator', creatorId, shopId: shopId ?? '' },
          },
          { idempotencyKey: `tr_${externalTxId}_creator` },
        );

        await this.prisma.transfer.upsert({
          where: { stripeTransferId: tr.id },
          update: { paymentId, kind: TransferKind.creator, amountJpy: split.creatorAmountJpy, destinationAcct: creator.stripeAccountId },
          create: { paymentId, kind: TransferKind.creator, amountJpy: split.creatorAmountJpy, destinationAcct: creator.stripeAccountId, stripeTransferId: tr.id },
        });
      }
    }

    // shop：shopIdがあれば台帳は必ず作る（未連携でもlocal）
    if (shopId && split.shopAmountJpy > 0) {
      const shop = await this.prisma.shop.findUnique({
        where: { id: shopId },
        select: { stripeAccountId: true },
      });

      if (!shop?.stripeAccountId) {
        await this.prisma.transfer.upsert({
          where: { stripeTransferId: `local_${externalTxId}_shop` },
          update: {
            paymentId,
            kind: TransferKind.shop,
            amountJpy: split.shopAmountJpy,
            destinationAcct: 'unlinked_shop',
            shopId, // ✅ 追加
          },
          create: {
            paymentId,
            kind: TransferKind.shop,
            amountJpy: split.shopAmountJpy,
            destinationAcct: 'unlinked_shop',
            stripeTransferId: `local_${externalTxId}_shop`,
            shopId, // ✅ 追加
          },
        });

        this.logger.warn(
          `shop transfer ledger created (stripeAccountId missing): shopId=${shopId}`,
        );
        return;
      }

      const tr = await this.stripe.transfers.create(
        {
          amount: split.shopAmountJpy,
          currency: 'jpy',
          destination: shop.stripeAccountId,
          transfer_group: externalTxId,
          source_transaction: chargeId ?? undefined,
          metadata: { kind: 'shop', creatorId, shopId },
        },
        { idempotencyKey: `tr_${externalTxId}_shop` },
      );

      await this.prisma.transfer.upsert({
        where: { stripeTransferId: tr.id },
        update: {
          paymentId,
          kind: TransferKind.shop,
          amountJpy: split.shopAmountJpy,
          destinationAcct: shop.stripeAccountId,
          shopId, // ✅ 追加
        },
        create: {
          paymentId,
          kind: TransferKind.shop,
          amountJpy: split.shopAmountJpy,
          destinationAcct: shop.stripeAccountId,
          stripeTransferId: tr.id,
          shopId, // ✅ 追加
        },
      });
    }
  }
}
