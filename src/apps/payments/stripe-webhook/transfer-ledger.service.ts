// api/src/apps/payments/stripe-webhook/transfer-ledger.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TransferKind } from '@prisma/client';

@Injectable()
export class TransferLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async upsertLocal(params: {
    paymentId: string;
    kind: TransferKind;
    amountJpy: number;
    destinationAcct: string;
    stripeTransferId: string; // local_...
    shopId?: string | null;
  }) {
    const { paymentId, kind, amountJpy, destinationAcct, stripeTransferId, shopId } = params;

    await this.prisma.transfer.upsert({
      where: { stripeTransferId },
      update: { paymentId, kind, amountJpy, destinationAcct, shopId: shopId ?? null },
      create: { paymentId, kind, amountJpy, destinationAcct, stripeTransferId, shopId: shopId ?? null },
    });
  }

  /**
   * Stripe transfer が成功したら local 台帳があればそれを tr.id に差し替えて統合する（重複防止）
   */
  async mergeLocalToStripe(params: {
    paymentId: string;
    kind: TransferKind;
    stripeTransferId: string;     // tr.id
    destinationAcct: string;      // connected acct
    amountJpy: number;
    localStripeTransferId: string; // local_...
    shopId?: string | null;
  }) {
    const {
      paymentId,
      kind,
      stripeTransferId,
      destinationAcct,
      amountJpy,
      localStripeTransferId,
      shopId,
    } = params;

    const localRow = await this.prisma.transfer.findUnique({
      where: { stripeTransferId: localStripeTransferId },
      select: { id: true },
    });

    if (localRow) {
      await this.prisma.transfer.update({
        where: { id: localRow.id },
        data: {
          stripeTransferId,
          destinationAcct,
          amountJpy,
          kind,
          shopId: shopId ?? null,
        },
      });
      return;
    }

    await this.prisma.transfer.upsert({
      where: { stripeTransferId },
      update: { paymentId, kind, amountJpy, destinationAcct, shopId: shopId ?? null },
      create: { paymentId, kind, amountJpy, destinationAcct, stripeTransferId, shopId: shopId ?? null },
    });
  }
}
