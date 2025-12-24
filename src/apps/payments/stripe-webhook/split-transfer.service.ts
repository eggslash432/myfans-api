// api/src/apps/payments/stripe-webhook/split-transfer.service.ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { PrismaService } from '../../prisma/prisma.service';
import { TransferKind } from '@prisma/client';
import { STRIPE_CLIENT } from './stripe-client.provider';

type FeeSettingLike = {
  id?: number;
  managerPercent?: number | null;
  shopPercent?: number | null;
  creatorPercent?: number | null;
  updatedAt?: Date;
};

@Injectable()
export class SplitTransferService {
  private readonly logger = new Logger(SplitTransferService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
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

  /**
   * パーセントから分配額（JPY円）を算出。
   * - 端数は floor で切り捨て
   * - 最終的な creator は残額で合わせる（合計一致を保証）
   */
  private splitByFeeSetting(totalJpy: number, setting: FeeSettingLike) {
    const manager = Math.floor(
      (totalJpy * (setting.managerPercent ?? 0)) / 100,
    );
    const shop = Math.floor((totalJpy * (setting.shopPercent ?? 0)) / 100);
    const creator = totalJpy - manager - shop;

    return {
      managerAmountJpy: manager,
      shopAmountJpy: shop,
      creatorAmountJpy: creator,
    };
  }

  /**
   * ✅ 分配と transfer 台帳作成を行う
   * - Payment にスナップショット金額（platform/shop/creator）を保存するのが“核心”
   * - 冪等：Transfer は idempotencyKey + upsert で二重作成を防ぐ
   */
  async createSplitTransfers(params: {
    paymentId: string;
    externalTxId: string; // transfer_group にも使う識別子（例: checkout session id 等）
    amountJpy: number;
    creatorId: string; // ⚠️ 現状は「creator.userId」を想定（呼び出し元が creator.id なら where を差し替え）
    shopId?: string | null;
    chargeId?: string | null;
  }) {
    const { paymentId, externalTxId, amountJpy, creatorId, shopId, chargeId } =
      params;

    const feeSetting = await this.getFeeSettingSafe();

    /**
     * ✅ 地雷対策①：shopId が無い支払いで shopPercent を引かない
     * - shop が存在しないのに shop取り分だけ引くと「金が消えた」ように見える
     * - ここでは shopPercent を 0 として再計算し、差分は creator に載せる
     */
    const effectiveSetting: FeeSettingLike = shopId
      ? feeSetting
      : {
          ...feeSetting,
          shopPercent: 0,
          // creatorPercent は説明用（必須ではないが、画面に出すなら整合を取る）
          creatorPercent:
            (feeSetting.creatorPercent ?? 0) + (feeSetting.shopPercent ?? 0),
        };

    const split = this.splitByFeeSetting(amountJpy, effectiveSetting);

    // ✅ まず Payment にスナップショット金額を保存（ここが安定化の核心）
    // - 既存に値が入っている場合は上書きして整合を優先（冪等）
    await this.prisma.payment.update({
      where: { id: paymentId },
      data: {
        // パーセント（後で説明に使える）
        managerPercent: effectiveSetting.managerPercent ?? null,
        shopPercent: effectiveSetting.shopPercent ?? null,
        creatorPercent: effectiveSetting.creatorPercent ?? null,

        // 金額（重要：管理画面表示 / PayoutsBalance の根拠）
        platformAmountJpy: split.managerAmountJpy,
        shopAmountJpy: split.shopAmountJpy,
        creatorAmountJpy: split.creatorAmountJpy,

        // 任意：Payment 側にも shopId を残す運用なら有効化
        // shopId: shopId ?? undefined,
      },
    });

    // --- platform 台帳（常にローカル台帳） ---
    if ((split.managerAmountJpy ?? 0) > 0) {
      await this.prisma.transfer.upsert({
        where: { stripeTransferId: `local_${externalTxId}_platform` },
        update: {
          paymentId,
          kind: TransferKind.platform,
          amountJpy: split.managerAmountJpy,
          destinationAcct: 'platform',
        },
        create: {
          paymentId,
          kind: TransferKind.platform,
          amountJpy: split.managerAmountJpy,
          destinationAcct: 'platform',
          stripeTransferId: `local_${externalTxId}_platform`,
        },
      });
    }

    // --- creator：送金できなければ台帳だけ ---
    /**
     * ✅ 地雷対策②：creatorId が何を指すか統一
     * - 現状コードは where: { userId: creatorId } なので creatorId は「creator.userId」を想定。
     * - もし呼び出し元が creator.id を渡しているなら where を { id: creatorId } に変更すること。
     */
    const creator = await this.prisma.creator.findUnique({
      where: { userId: creatorId },
      // where: { id: creatorId }, // ← 呼び出し元が creator.id の場合はこちらに差し替え
      select: { stripeAccountId: true },
    });

    if (!creator?.stripeAccountId) {
      if (split.creatorAmountJpy > 0) {
        await this.prisma.transfer.upsert({
          where: { stripeTransferId: `local_${externalTxId}_creator` },
          update: {
            paymentId,
            kind: TransferKind.creator,
            amountJpy: split.creatorAmountJpy,
            destinationAcct: 'unlinked_creator',
          },
          create: {
            paymentId,
            kind: TransferKind.creator,
            amountJpy: split.creatorAmountJpy,
            destinationAcct: 'unlinked_creator',
            stripeTransferId: `local_${externalTxId}_creator`,
          },
        });
      }
    } else {
      if (split.creatorAmountJpy > 0) {
        try {
          const tr = await this.stripe.transfers.create(
            {
              amount: split.creatorAmountJpy, // ✅ JPY は円単位
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
            update: {
              paymentId,
              kind: TransferKind.creator,
              amountJpy: split.creatorAmountJpy,
              destinationAcct: creator.stripeAccountId,
            },
            create: {
              paymentId,
              kind: TransferKind.creator,
              amountJpy: split.creatorAmountJpy,
              destinationAcct: creator.stripeAccountId,
              stripeTransferId: tr.id,
            },
          });
        } catch (e: any) {
          this.logger.error(
            `stripe transfer failed (creator): paymentId=${paymentId} externalTxId=${externalTxId} amount=${split.creatorAmountJpy} creatorId=${creatorId} shopId=${shopId ?? ''}`,
            e?.stack ?? String(e),
          );
          // 送金失敗でも台帳（未連携扱い）を残す：運用上の追跡性を優先
          await this.prisma.transfer.upsert({
            where: { stripeTransferId: `local_${externalTxId}_creator` },
            update: {
              paymentId,
              kind: TransferKind.creator,
              amountJpy: split.creatorAmountJpy,
              destinationAcct: 'transfer_failed_creator',
            },
            create: {
              paymentId,
              kind: TransferKind.creator,
              amountJpy: split.creatorAmountJpy,
              destinationAcct: 'transfer_failed_creator',
              stripeTransferId: `local_${externalTxId}_creator`,
            },
          });
        }
      }
    }

    // --- shop：shopId があれば台帳は必ず作る（未連携でもlocal） ---
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
            shopId,
          },
          create: {
            paymentId,
            kind: TransferKind.shop,
            amountJpy: split.shopAmountJpy,
            destinationAcct: 'unlinked_shop',
            stripeTransferId: `local_${externalTxId}_shop`,
            shopId,
          },
        });

        this.logger.warn(
          `shop transfer ledger created (stripeAccountId missing): paymentId=${paymentId} shopId=${shopId}`,
        );
        return;
      }

      try {
        const tr = await this.stripe.transfers.create(
          {
            amount: split.shopAmountJpy, // ✅ JPY は円単位
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
            shopId,
          },
          create: {
            paymentId,
            kind: TransferKind.shop,
            amountJpy: split.shopAmountJpy,
            destinationAcct: shop.stripeAccountId,
            stripeTransferId: tr.id,
            shopId,
          },
        });
      } catch (e: any) {
        this.logger.error(
          `stripe transfer failed (shop): paymentId=${paymentId} externalTxId=${externalTxId} amount=${split.shopAmountJpy} shopId=${shopId}`,
          e?.stack ?? String(e),
        );

        await this.prisma.transfer.upsert({
          where: { stripeTransferId: `local_${externalTxId}_shop` },
          update: {
            paymentId,
            kind: TransferKind.shop,
            amountJpy: split.shopAmountJpy,
            destinationAcct: 'transfer_failed_shop',
            shopId,
          },
          create: {
            paymentId,
            kind: TransferKind.shop,
            amountJpy: split.shopAmountJpy,
            destinationAcct: 'transfer_failed_shop',
            stripeTransferId: `local_${externalTxId}_shop`,
            shopId,
          },
        });
      }
    }
  }
}
