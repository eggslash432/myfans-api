// api/src/apps/payments/payments.controller.ts

import {
  Body,
  Controller,
  Post,
  Req,
  BadRequestException,
  UnauthorizedException,
  UseGuards,
  Param,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCheckoutValidatedDto } from './dto/create-checkout.dto';
import { UserJwt } from 'src/shared/types';
import { ConfigService } from '@nestjs/config';

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
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
    if (!user?.id) {
      throw new UnauthorizedException('Unauthenticated');
    }

    const successUrl =
      dto.successUrl ?? `${this.config.get('FRONT_ORIGIN')}/payments/success`;
    const cancelUrl =
      dto.cancelUrl ?? `${this.config.get('FRONT_ORIGIN')}/payments/cancel`;      

    const userId = user.id;

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
        successUrl,
        cancelUrl,
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

      // ✅ successUrl / cancelUrl を service に渡す
      const { url } = await this.payments.createCheckoutForPost(
        userId,
        post.id,
        successUrl,
        cancelUrl,
      );

      return { url };
    }

    throw new BadRequestException('Either planId or postId is required');
  }

  // controller の下に追加
  @UseGuards(JwtAuthGuard)
  @Post('ppv/:postId/checkout')
  async createPpvCheckoutLegacy(
    @Param('postId') postId: string,
    @Req() req: any,
  ) {
    const user = req.user as UserJwt | undefined;
    if (!user?.id) {
      throw new UnauthorizedException('Unauthenticated');
    }

    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: { id: true, priceJpy: true },
    });

    if (!post) throw new BadRequestException('post not found');
    if (!post.priceJpy) throw new BadRequestException('post has no PPV price');

    const { url } = await this.payments.createCheckoutForPost(
      user.id,
      post.id,
      undefined,
      undefined,
    );

    return { url };
  }  
}
