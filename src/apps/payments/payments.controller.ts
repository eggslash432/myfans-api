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
import { PrismaService } from '../prisma/prisma.service';
import { CreateCheckoutValidatedDto } from './dto/create-checkout.dto';
import { UserJwt } from 'src/shared/types';
import { ConfigService } from '@nestjs/config';
import { StripeCheckoutService } from './stripe/stripe-checkout.service';

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly checkout: StripeCheckoutService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Checkout API（plan / ppv 共通）
   * POST /api/payments/checkout
   * body: { planId?, postId?, successUrl?, cancelUrl? }
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

    const frontOrigin =
      this.config.get<string>('FRONT_ORIGIN') ?? 'http://localhost:5173';

    const successUrl =
      dto.successUrl ?? `${frontOrigin}/payments/success`;
    const cancelUrl =
      dto.cancelUrl ?? `${frontOrigin}/payments/cancel`;

    const userId = user.id;

    // ============================
    // ① サブスク（plan）
    // ============================
    if (dto.planId) {
      const plan = await this.prisma.plan.findUnique({
        where: { id: dto.planId },
        select: {
          id: true,
          isActive: true,
          creatorId: true,
        },
      });

      if (!plan) {
        throw new BadRequestException('plan not found');
      }
      if (!plan.isActive) {
        throw new BadRequestException('plan is inactive');
      }

      const { url } = await this.checkout.createCheckoutForPlan(
        userId,
        plan.creatorId, // ← creator.userId 前提
        plan.id,
        successUrl,
        cancelUrl,
      );

      return { url };
    }

    // ============================
    // ② PPV（post）
    // ============================
    if (dto.postId) {
      const post = await this.prisma.post.findUnique({
        where: { id: dto.postId },
        select: {
          id: true,
          priceJpy: true,
        },
      });

      if (!post) {
        throw new BadRequestException('post not found');
      }
      if (!post.priceJpy) {
        throw new BadRequestException('post has no PPV price');
      }

      const { url } = await this.checkout.createCheckoutForPost(
        userId,
        post.id,
        successUrl,
        cancelUrl,
      );

      return { url };
    }

    throw new BadRequestException('Either planId or postId is required');
  }

  /**
   * legacy: PPV checkout
   * POST /api/payments/ppv/:postId/checkout
   */
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
      select: {
        id: true,
        priceJpy: true,
      },
    });

    if (!post) {
      throw new BadRequestException('post not found');
    }
    if (!post.priceJpy) {
      throw new BadRequestException('post has no PPV price');
    }

    const { url } = await this.checkout.createCheckoutForPost(
      user.id,
      post.id,
      undefined,
      undefined,
    );

    return { url };
  }
}
