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
    const userId = userIdRaw;

    if (!userId || typeof userId !== 'string') {
      throw new BadRequestException('invalid user id: ' + userIdRaw);
    }

    // ユーザーが実在するか一応チェック
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new BadRequestException('user not found: ' + userId);
    }  

    // publicName を決定
    const publicName =
      dto.publicName ??
      dto.displayName ??
      user.email?.split('@')[0];

    if (!publicName) {
      throw new BadRequestException(
        'publicName または displayName を指定してください',
      );
    }

    console.log("applyCreator user=", userId);
    console.log("dto=", dto);    

    // Creator があれば更新、なければ新規作成
    const creator = await this.prisma.creator.upsert({
      where: { userId }, // PK = userId
      update: {
        publicName,
        bankAccount: dto.bankAccount ?? undefined,
      },
      create: {
        userId,
        publicName,
        bankAccount: dto.bankAccount ?? undefined,
        isListed: false, 
      },
    });

    console.log("creator created/updated =", creator);

    // 一般ユーザーだけ role を creator に昇格させる
    if (user.role === Role.fan) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { role: Role.creator },
      });
    }

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

  async createKycLink(stripeAccountId: string) {
    const link = await this.stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: process.env.FRONTEND_URL + "/kyc/refresh",
      return_url: process.env.FRONTEND_URL + "/kyc/complete",
      type: "account_onboarding",
    });
    return link.url;
  }  

  // クリエイター情報 + KYCステータス取得（本人用）
  async getMe(userIdRaw: string) {
    const userId = String(userIdRaw);

    // ★ profile も一緒に取得する
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
      },
    });
    if (!user) {
      throw new NotFoundException('user not found: ' + userId);
    }

    // まず Creator があるかチェック
    let creator = await this.prisma.creator.findUnique({ where: { userId } });

    if (!creator) {
      // まだ Creator 行が無ければ自動で作る（publicName は email の @ 前 を使用）
      const publicName =
        user.email?.split('@')[0] ??
        'creator';

      creator = await this.prisma.creator.create({
        data: {
          userId,
          publicName,
          isListed: false,
        },
      });
    }

    // ---- DB の既存値を初期値にする ----
    let stripeKycStatus = creator.stripeKycStatus ?? 'pending';
    let stripeChargesEnabled = creator.stripeChargesEnabled ?? false;
    let stripePayoutsEnabled = creator.stripePayoutsEnabled ?? false;
    let stripeKycDisabledReason = creator.stripeKycDisabledReason ?? null;

    // DB は String? なので、画面用にパースして配列にしておく
    let stripeKycFieldsDue: string[] =
      creator.stripeKycFieldsDue ? creator.stripeKycFieldsDue.split(',') : [];
    let stripeKycErrors: any[] =
      creator.stripeKycErrors ? JSON.parse(creator.stripeKycErrors) : [];

    // ---- Stripe アカウントIDがあるなら、最新状態を Stripe から取得 ----
    if (creator.stripeAccountId) {
      // ★ this.stripe を使う
      const account = await this.stripe.accounts.retrieve(
        creator.stripeAccountId,
      );

      // 型付きで requirements を取り出す
      const req = account.requirements; // Stripe.Account.Requirements | null | undefined

      const fieldsDueArray = [
        ...(req?.currently_due ?? []),
        ...(req?.past_due ?? []),
      ];

      const errorsArray = req?.errors ?? [];

      // ステータス判定
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

      // ← ここを「必ず boolean」にする
      stripeChargesEnabled = !!account.charges_enabled;
      stripePayoutsEnabled = !!account.payouts_enabled;

      // 画面用
      stripeKycFieldsDue = fieldsDueArray;
      stripeKycErrors = errorsArray;

      // ★ Prisma には String? で保存する
      await this.prisma.creator.update({
        where: { userId },
        data: {
          stripeKycStatus,
          stripeChargesEnabled,
          stripePayoutsEnabled,
          stripeKycDisabledReason,
          stripeKycFieldsDue:
            fieldsDueArray.length > 0 ? fieldsDueArray.join(',') : null,
          stripeKycErrors:
            errorsArray.length > 0 ? JSON.stringify(errorsArray) : null,
        },
      });
    }

    // ---- フロントに返すデータ ----
    return {
      isCreator: true,
      publicName: creator.publicName,
      // ★ ここで profile から bio / avatarUrl を返す
      bio: user.profile?.bio ?? '',
      avatarUrl: user.profile?.avatarUrl ?? null,      
      stripeAccountId: creator.stripeAccountId,
      stripeKycStatus,
      stripeChargesEnabled,
      stripePayoutsEnabled,
      stripeKycDisabledReason,
      // ここは配列のまま返す（画面で使いやすいように）
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
