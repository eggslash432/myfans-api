import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CreatorHelper } from '../helpers/creator.helper';
import { UserJwt } from 'src/shared/types';

@Controller('creators/me/payouts')
@UseGuards(JwtAuthGuard)
export class CreatorPayoutsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly creatorHelper: CreatorHelper,
  ) {}

  /**
   * 共通：creator の出金可能残高を計算
   */
  private async calcBalance(creatorId: string): Promise<number> {
    // 1) creator の確定売上（paid のみ）
    const paymentsAgg = await this.prisma.payment.aggregate({
      where: {
        creatorId,
        paymentStatus: 'paid',
      },
      _sum: {
        creatorAmountJpy: true,
      },
    });

    const totalEarnings = paymentsAgg._sum?.creatorAmountJpy ?? 0;

    // 2) 既に申請・承認・支払済みの出金合計（CREATORのみ）
    const payoutsAgg = await this.prisma.payout.aggregate({
      where: {
        targetType: 'CREATOR',
        creatorId,
        payoutStatus: {
          in: ['requested', 'approved', 'paid'],
        },
      },
      _sum: {
        amountJpy: true,
      },
    });

    const requestedOrPaid = payoutsAgg._sum?.amountJpy ?? 0;

    // 3) 残高
    return Math.max(totalEarnings - requestedOrPaid, 0);
  }

  /**
   * ① 出金可能残高の取得
   * GET /api/creators/me/payouts/balance
   *
   * フロント期待: { balanceJpy: number }
   */
  @Get('balance')
  async getBalance(@Req() req: any) {
    const user = req.user as UserJwt | undefined;
    const userId = user?.id;
    if (!userId) throw new BadRequestException('Unauthenticated');

    const creatorId = await this.creatorHelper.getMyCreatorId(userId);
    const balance = await this.calcBalance(creatorId);

    return { balanceJpy: balance };
  }

  /**
   * ② 出金履歴一覧
   * GET /api/creators/me/payouts
   */
  @Get()
  async listPayouts(@Req() req: any) {
    const user = req.user as UserJwt | undefined;
    const userId = user?.id;
    if (!userId) throw new BadRequestException('Unauthenticated');

    const creatorId = await this.creatorHelper.getMyCreatorId(userId);

    const items = await this.prisma.payout.findMany({
      where: {
        targetType: 'CREATOR',
        creatorId,
      },
      orderBy: { requestedAt: 'desc' },
    });

    return items;
  }

  /**
   * ③ 出金申請の作成
   * POST /api/creators/me/payouts/request
   * body: { amountJpy: number, note?: string }
   */
  @Post('request')
  async requestPayout(
    @Req() req: any,
    @Body()
    dto: {
      amountJpy?: number;
      note?: string;
    },
  ) {
    const user = req.user as UserJwt | undefined;
    const userId = user?.id;
    if (!userId) throw new BadRequestException('Unauthenticated');

    const creatorId = await this.creatorHelper.getMyCreatorId(userId);

    const amount = Number(dto.amountJpy ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('amountJpy must be a positive number');
    }

    // 残高チェック（共通ロジック）
    const balance = await this.calcBalance(creatorId);

    if (amount > balance) {
      throw new BadRequestException(
        `出金額が利用可能残高を超えています (利用可能: ${balance}円)`,
      );
    }

    const payout = await this.prisma.payout.create({
      data: {
        targetType: 'CREATOR',
        creatorId,
        amountJpy: amount,
        payoutStatus: 'requested',
        note: dto.note ?? null,
      },
    });

    return payout;
  }
}
