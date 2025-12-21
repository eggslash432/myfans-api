// api/src/apps/creators/creators.service.ts

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { KycStatus } from '@prisma/client';
import { CreatorApplyService } from './apply/creator-apply.service';
import { CreatorPublicService } from './public/creator-public.service';
import { CreatorStripeService } from './stripe/creator-stripe.service';
import { CreatorAnalyticsService } from './analytics/creator-analytics.service';
import { CreatorProfileService } from './profile/creator-profile.service';
import { UpdateCreatorProfileDto } from './dto/update-creator-profile.dto';
import { CreateCreatorDto } from './dto/create-creator.dto';
import { StripeClientProvider } from './stripe/stripe-client.provider';

@Injectable()
export class CreatorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly applySvc: CreatorApplyService,
    private readonly publicSvc: CreatorPublicService,
    private readonly stripeSvc: CreatorStripeService,
    private readonly analyticsSvc: CreatorAnalyticsService,
    private readonly profileSvc: CreatorProfileService,
    private readonly stripeProvider: StripeClientProvider,
  ) {}

  // --- apply ---
  applyCreator(userIdRaw: string, dto: CreateCreatorDto) {
    return this.applySvc.applyCreator(userIdRaw, dto);
  }

  // --- public profile ---
  getPublicProfile(creatorId: string) {
    return this.publicSvc.getPublicProfile(creatorId);
  }

  // --- checkout / kyc ---
  createSubscriptionCheckout(creatorId: string, planId: string) {
    return this.stripeSvc.createSubscriptionCheckout(creatorId, planId);
  }
  startKyc(userId: string) {
    return this.stripeSvc.startKyc(userId);
  }

  // --- analytics ---
  getMySimpleAnalytics(userId: string) {
    return this.analyticsSvc.getMySimpleAnalytics(userId);
  }
  getMyRevenueTrend(userId: string, params: any) {
    return this.analyticsSvc.getMyRevenueTrend(userId, params);
  }
  getMyPostRanking(userId: string, params: any) {
    return this.analyticsSvc.getMyPostRanking(userId, params);
  }
  getMySubscriberTrend(userId: string, params: any) {
    return this.analyticsSvc.getMySubscriberTrend(userId, params);
  }

  // --- profile update ---
  async updateProfile(userId: string, dto: UpdateCreatorProfileDto) {
    await this.profileSvc.updateProfile(userId, dto);
    return this.getMe(userId);
  }

  // --- creator (本人) info ---
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

  // --- getMe / KYC refresh (承認済みのみ) ---
  async getMe(userIdRaw: string) {
    const userId = String(userIdRaw);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true },
    });
    if (!user) throw new NotFoundException('user not found: ' + userId);

    const creator = await this.prisma.creator.findUnique({ where: { userId } });

    if (!creator) {
      return { isCreator: false, approvalStatus: null };
    }

    const approvalStatus = (creator as any).approvalStatus ?? 'pending';
    const isApproved = approvalStatus === 'approved';

    let stripeKycStatus = creator.stripeKycStatus ?? 'pending';
    let stripeChargesEnabled = creator.stripeChargesEnabled ?? false;
    let stripePayoutsEnabled = creator.stripePayoutsEnabled ?? false;
    let stripeKycDisabledReason = creator.stripeKycDisabledReason ?? null;

    let stripeKycFieldsDue: string[] = creator.stripeKycFieldsDue
      ? creator.stripeKycFieldsDue.split(',')
      : [];
    let stripeKycErrors: any[] = creator.stripeKycErrors
      ? JSON.parse(creator.stripeKycErrors)
      : [];

    if (isApproved && creator.stripeAccountId) {
      const account = await this.stripeProvider.stripe.accounts.retrieve(
        creator.stripeAccountId,
      );
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
      isCreator: isApproved,
      publicName: creator.publicName,
      bio: user.profile?.bio ?? '',
      avatarUrl: user.profile?.avatarUrl ?? null,

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
}
