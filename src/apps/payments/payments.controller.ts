// src/apps/payments/payments.controller.ts

import {
  Body,
  Controller,
  Post,
  Req,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCheckoutValidatedDto } from './dto/create-checkout.dto';

type UserJwt = {
  sub: string; // userId
  email?: string;
  role: 'fan' | 'creator' | 'admin';
};

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * 1本化された Checkout API
   * POST /api/payments/checkout
   * body: { planId?, postId?, successUrl, cancelUrl }
   */
  @UseGuards(JwtAuthGuard)
  @Post('checkout')
  async createCheckout(
    @Body() dto: CreateCheckoutValidatedDto,
    @Req() req: any,
  ) {
    const user = req.user as UserJwt | undefined;
    if (!user?.sub) throw new BadRequestException('Unauthenticated');

    const userId = user.sub;

    // ============================================
    // ① サブスク（planId）
    // ============================================
    if (dto.planId) {
      const plan = await this.prisma.plan.findUnique({
        where: { id: dto.planId },
        select: {
          id: true,
          name: true,
          priceJpy: true,
          isActive: true,
          creatorId: true,
          externalPriceId: true,
        },
      });
      if (!plan) throw new BadRequestException('plan not found');
      if (!plan.isActive) throw new BadRequestException('plan is inactive');

      const { url } = await this.payments.createCheckoutForPlan(
        userId,
        plan.creatorId,
        plan.id,
      );

      return { url };
    }

    // ============================================
    // ② PPV（postId）
    // ============================================
    if (dto.postId) {
      const post = await this.prisma.post.findUnique({
        where: { id: dto.postId },
        select: { id: true, priceJpy: true, creatorId: true },
      });
      if (!post) {
        throw new BadRequestException('post not found');
      }
      if (!post.priceJpy) {
        throw new BadRequestException('post has no PPV price');
      }

      const { url } = await this.payments.createCheckoutForPost(
        userId,
        post.id,
      );

      return { url };
    }

    // （ここに来ることは DTO バリデーション上、本来ありえない）
    throw new BadRequestException('Either planId or postId is required');
  }
}
