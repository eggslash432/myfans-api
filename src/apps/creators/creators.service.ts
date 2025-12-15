// api/src/apps/creators/creators.service.ts

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCreatorDto } from './dto/create-creator.dto';
import { KycStatus, Role } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { UpdateCreatorProfileDto } from './dto/update-creator-profile.dto';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {});

@Injectable()
export class CreatorsService {
  private readonly stripe: Stripe;

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
    const userId = String(userIdRaw);

    if (!userId) {
      throw new BadRequestException('invalid user id: ' + userIdRaw);
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new BadRequestException('user not found: ' + userId);
    }

    const publicName =
      dto.publicName ??
      dto.displayName ??
      user.email?.split('@')[0];

    if (!publicName) {
      throw new BadRequestException('publicName または displayName を指定してください');
    }

    const creator = await this.prisma.creator.upsert({
      where: { userId },
      update: {
        publicName,
        bankAccount: dto.bankAccount ?? undefined,
        // ★ 審査制：申請したら pending に戻す（再申請も同じ）
        approvalStatus: 'pending' as any,
        isListed: false,
        rejectedAt: null,
        rejectReason: null,
        approvedAt: null,
      },
      create: {
        userId,
        publicName,
        bankAccount: dto.bankAccount ?? undefined,
        isListed: false,
        approvalStatus: 'pending' as any,
      },
    });

    // ★ 履歴を1行追加（再申請含む）
    await this.prisma.creatorApplication.create({
      data: {
        userId,
        publicName,
        bankAccount: dto.bankAccount ?? undefined,
        status: 'pending' as any,
      },
    });    

    // ★ 審査制：ここで role を上げない
    return creator;
  }

  async getCreator(userId: string) {
    const creator = await this.prisma.creator.findUnique({
      where: { userId },
      select: {
        userId: true,
        publicName: true,
        stripeAccountId: true,
        stripeKycStatus: true,
        stripeChargesEnabled: true,
        stripePayoutsEnabled: true,
        stripeKycDisabledReason: true,
        stripeKycErrors: true,
        stripeKycFieldsDue: true,
        isListed: true,
      },
    });

    return {
      ...creator,
      kyc: {
        status: creator?.stripeKycStatus,
        chargesEnabled: creator?.stripeChargesEnabled,
        payoutsEnabled: creator?.stripePayoutsEnabled,
        disabledReason: creator?.stripeKycDisabledReason,
        errors: creator?.stripeKycErrors,
        fieldsDue: creator?.stripeKycFieldsDue,
      },
    };
  }  

  // === ここから追加: 公開プロフィール ===
  async getPublicProfile(creatorId: string) {
    const creator = await this.prisma.creator.findUnique({
      where: { userId: creatorId },
      select: {
        userId: true,
        publicName: true,
        user: {
          select: {
            profile: {
              select: {
                bio: true,
                avatarUrl: true,
                displayName: true,
              },
            },
          },
        },
        plans: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            name: true,
            priceJpy: true,
            billingInterval: true,
            isActive: true,
            sortOrder: true,
          },
        },
      },
    });

    if (!creator) {
      throw new NotFoundException('creator not found: ' + creatorId);
    }

    return {
      id: creator.userId,
      publicName: creator.publicName,
      displayName: creator.user.profile?.displayName ?? creator.publicName,
      bio: creator.user.profile?.bio ?? null,
      avatarUrl: creator.user.profile?.avatarUrl ?? null,
      plans: creator.plans.map((p) => ({
        id: p.id,
        name: p.name,
        priceJpy: p.priceJpy,               // ← Int のまま返す
        billingInterval: p.billingInterval ?? 'month',
        isActive: p.isActive,
        sortOrder: p.sortOrder,
      })),
    };
  }

  async createSubscriptionCheckout(creatorId: string, planId: string) {
    const plan = await this.prisma.plan.findUnique({ where: { id: planId } });
    if (!plan || plan.creatorId !== creatorId)
      throw new NotFoundException('Plan not found');

    const creator = await this.prisma.creator.findUnique({
      where: { userId: creatorId },
    });
    if (!creator?.stripeAccountId) {
      throw new BadRequestException('Stripe account not linked for creator');
    }

    const priceId = plan.externalPriceId;
    if (!priceId) {
      throw new NotFoundException('externalPriceId (Stripe price) missing');
    }

    const session = await this.stripe.checkout.sessions.create(
      {
        mode: 'subscription',
        success_url: `${process.env.APP_ORIGIN}/mypage?result=success`,
        cancel_url: `${process.env.APP_ORIGIN}/creators/${creatorId}?cancelled=1`,
        line_items: [{ price: priceId, quantity: 1 }],
        metadata: { creatorId, planId },
      },
      { stripeAccount: creator.stripeAccountId }, // ★ 追加
    );

    return session.url!;
  }

  async createStripeAccountForCreator(userId: string) {
    const account = await this.stripe.accounts.create({
      type: 'express',
      country: 'JP',
      business_type: 'individual',
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    });

    await this.prisma.creator.update({
      where: { userId },
      data: { stripeAccountId: account.id },
    });

    return account.id;
  }  

  private frontendOrigin() {
    return (
      process.env.APP_ORIGIN ||
      process.env.FRONTEND_URL ||
      this.config.get<string>("APP_ORIGIN") ||
      this.config.get<string>("FRONTEND_URL") ||
      "http://localhost:5173"
    );
  }

  async createKycLink(stripeAccountId: string) {
    const origin = this.frontendOrigin();

    const link = await this.stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: `${origin}/creator/payouts?kyc=refresh`,
      return_url: `${origin}/creator/payouts?kyc=complete`,
      type: "account_onboarding",
    });

    return link.url;
  }

  /**
   * クリエイター本人用のシンプル売上サマリー
   * - 累計売上（creator取り分ベース）
   * - アクティブ購読者数
   */
  async getMySimpleAnalytics(userId: string) {
    // 累計売上（creatorAmountJpy を合計）
    const paymentAgg = await this.prisma.payment.aggregate({
      where: {
        creatorId: userId,
        paymentStatus: 'paid',   // enumなら必要に応じて調整
      },
      _sum: {
        creatorAmountJpy: true,  // createPaymentWithShare が入れているカラム
      },
    });

    const totalRevenueJpy = paymentAgg._sum.creatorAmountJpy ?? 0;

    // アクティブ購読者数（サブスクリプション）
    const totalSubscribers = await this.prisma.subscription.count({
      where: {
        creatorId: userId,
        status: {
          in: ['active', 'trialing'] as any, // SubscriptionStatus に合わせて調整
        },
      },
    });

    return {
      totalRevenueJpy,
      totalSubscribers,
    };
  }  

  // クリエイター情報 + KYCステータス取得（本人用）
  async getMe(userIdRaw: string) {
    const userId = String(userIdRaw);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });
    if (!user) throw new NotFoundException('user not found: ' + userId);

    const creator = await this.prisma.creator.findUnique({ where: { userId } });

    // ★ 未申請は null を返す（例外にしない）
    if (!creator) {
      return {
        isCreator: false,
        approvalStatus: null,
      };
    }

    // approvalStatus を前提に UI 分岐する
    const approvalStatus = (creator as any).approvalStatus ?? 'pending';
    const isApproved = approvalStatus === 'approved';

    // ---- KYC 情報（承認済みクリエイターのみ更新するのが無難）----
    // 審査前に Stripe 情報を取りに行きたくないなら、ここでガードできる：
    // if (!isApproved) { Stripe 取得・DB update をスキップ }
    let stripeKycStatus = creator.stripeKycStatus ?? 'pending';
    let stripeChargesEnabled = creator.stripeChargesEnabled ?? false;
    let stripePayoutsEnabled = creator.stripePayoutsEnabled ?? false;
    let stripeKycDisabledReason = creator.stripeKycDisabledReason ?? null;

    let stripeKycFieldsDue: string[] =
      creator.stripeKycFieldsDue ? creator.stripeKycFieldsDue.split(',') : [];
    let stripeKycErrors: any[] =
      creator.stripeKycErrors ? JSON.parse(creator.stripeKycErrors) : [];

    if (isApproved && creator.stripeAccountId) {
      const account = await this.stripe.accounts.retrieve(creator.stripeAccountId);
      const req = account.requirements;

      const fieldsDueArray = [
        ...(req?.currently_due ?? []),
        ...(req?.past_due ?? []),
      ];
      const errorsArray = req?.errors ?? [];

      if (req?.disabled_reason) {
        stripeKycStatus = KycStatus.rejected;
        stripeKycDisabledReason = req.disabled_reason;
      } else if (fieldsDueArray.length === 0) {
        stripeKycStatus = KycStatus.approved;
        stripeKycDisabledReason = null;
      } else {
        stripeKycStatus = KycStatus.pending;
        stripeKycDisabledReason = null;
      }

      stripeChargesEnabled = !!account.charges_enabled;
      stripePayoutsEnabled = !!account.payouts_enabled;

      stripeKycFieldsDue = fieldsDueArray;
      stripeKycErrors = errorsArray;

      await this.prisma.creator.update({
        where: { userId },
        data: {
          stripeKycStatus,
          stripeChargesEnabled,
          stripePayoutsEnabled,
          stripeKycDisabledReason,
          stripeKycFieldsDue: fieldsDueArray.length ? fieldsDueArray.join(',') : null,
          stripeKycErrors: errorsArray.length ? JSON.stringify(errorsArray) : null,
        },
      });
    }

    return {
      // ★ isCreator = 管理者承認済みかどうか
      isCreator: isApproved,

      publicName: creator.publicName,
      bio: user.profile?.bio ?? '',
      avatarUrl: user.profile?.avatarUrl ?? null,

      // ★ 審査情報を返す（MyPageでここを見て分岐）
      approvalStatus,
      approvedAt: (creator as any).approvedAt ?? null,
      rejectedAt: (creator as any).rejectedAt ?? null,
      rejectReason: (creator as any).rejectReason ?? null,

      stripeAccountId: creator.stripeAccountId,
      stripeKycStatus,
      stripeChargesEnabled,
      stripePayoutsEnabled,
      stripeKycDisabledReason,
      stripeKycFieldsDue,
      stripeKycErrors,
    };
  }

  // ★ プロフィール更新
  async updateProfile(userId: string, dto: UpdateCreatorProfileDto) {
    // Creator が存在するかチェック
    const creator = await this.prisma.creator.findUnique({ where: { userId } });
    if (!creator) {
      throw new NotFoundException('creator not found: ' + userId);
    }

    // Creator.publicName を更新（指定があれば）
    if (dto.publicName !== undefined) {
      await this.prisma.creator.update({
        where: { userId },
        data: {
          publicName: dto.publicName,
        },
      });
    }

    // プロフィール（bio / avatarUrl）は Profile モデル側に保存すると仮定
    if (dto.bio !== undefined || dto.avatarUrl !== undefined) {
      await this.prisma.profile.upsert({
        where: { userId },
        update: {
          ...(dto.bio !== undefined ? { bio: dto.bio } : {}),
          ...(dto.avatarUrl !== undefined ? { avatarUrl: dto.avatarUrl } : {}),
        },
        create: {
          userId,
          displayName: dto.publicName ?? creator.publicName,
          bio: dto.bio ?? null,
          avatarUrl: dto.avatarUrl ?? null,
        },
      });
    }

    // 更新後の情報をそのままフロントに返したいので getMe を再利用
    return this.getMe(userId);
  }  

  // KYC開始用（アカウントを作ってリンク返す）
  async startKyc(userId: string) {
    // 1. Creator を取得
    const creator = await this.prisma.creator.findUnique({ where: { userId } });
    if (!creator) {
      throw new BadRequestException('クリエイター登録が必要です');
    }

    // 2. Stripeアカウントが無ければ作成
    const accountId =
      creator.stripeAccountId ??
      (await this.createStripeAccountForCreator(userId));

    // 3. KYCリンクを作成
    const url = await this.createKycLink(accountId);

    return { url, stripeKycStatus: creator.stripeKycStatus ?? 'pending' };
  }  
}
