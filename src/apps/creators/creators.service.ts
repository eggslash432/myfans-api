import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCreatorDto } from './dto/create-creator.dto';
import { KycStatus, Role } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

@Injectable()
export class CreatorsService {
  private stripe: Stripe;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    const key = this.config.get<string>('STRIPE_SECRET_KEY');
    if (!key) {
      throw new Error('STRIPE_SECRET_KEY is not set');
    }
    this.stripe = new Stripe(key);
  }

  async applyCreator(userIdRaw: string, dto: CreateCreatorDto) {
    const userId = userIdRaw;

    if (!userId || typeof userId !== 'string') {
      throw new BadRequestException('invalid user id: ' + userIdRaw);
    }

    // 既に Creator なら弾く
    const existing = await this.prisma.creator.findUnique({ where: { userId } });
    if (existing) {
      throw new BadRequestException('すでにクリエイター登録済みです');
    }

    // publicName は Creator.publicName へ
    const publicName = dto.publicName ?? dto.displayName;
    if (!publicName) {
      throw new BadRequestException('publicName または displayName を指定してください');
    }

    // Creator レコード作成
    const creator = await this.prisma.creator.create({
      data: {
        userId,
        publicName,
        bankAccount: dto.bankAccount ?? undefined,
      },
    });

    // Profile（任意）更新
    if (dto.displayName || dto.bio) {
      await this.prisma.profile.upsert({
        where: { userId },
        update: {
          displayName: dto.displayName ?? undefined,
          bio: dto.bio ?? undefined,
        },
        create: {
          userId,
          displayName: dto.displayName ?? dto.publicName ?? '',
          bio: dto.bio ?? null,
        },
      });
    }

    // KYC 申請（任意）
    if (dto.kycDocuments) {
      await this.prisma.kycSubmission.create({
        data: {
          userId,
          status: KycStatus.pending,
          documents: dto.kycDocuments,
        },
      });
    }

    // ユーザーの role を creator に昇格
    await this.prisma.user.update({
      where: { id: userId },
      data: { role: Role.creator },
    });

    return creator;
  }

  async createSubscriptionCheckout(creatorId: string, planId: string) {
    const plan = await this.prisma.plan.findUnique({ where: { id: planId } });
    if (!plan || plan.creatorId !== creatorId) throw new NotFoundException('Plan not found');

    const priceId = plan.externalPriceId; // ← Prismaの型に存在するフィールド名
    if (!priceId) throw new NotFoundException('externalPriceId (Stripe price) missing');

    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      success_url: `${process.env.APP_ORIGIN}/mypage?result=success`,
      cancel_url: `${process.env.APP_ORIGIN}/creator/${creatorId}/plans?cancelled=1`,
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: undefined, // 既存Customerに紐付けるなら customer を指定
      // customer: 'cus_xxx',
      metadata: { creatorId, planId },
    });

    return session.url!; // これをフロントへ返す
  }
}
