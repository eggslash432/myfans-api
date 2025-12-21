// api/src/apps/creators/public/creator-public.service.ts

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CreatorPublicService {
  constructor(private readonly prisma: PrismaService) {}

  async getPublicProfile(creatorId: string) {
    const creator = await this.prisma.creator.findUnique({
      where: { userId: creatorId },
      select: {
        userId: true,
        publicName: true,
        user: {
          select: {
            profile: {
              select: { bio: true, avatarUrl: true, displayName: true },
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

    if (!creator) throw new NotFoundException('creator not found: ' + creatorId);

    return {
      id: creator.userId,
      publicName: creator.publicName,
      displayName: creator.user.profile?.displayName ?? creator.publicName,
      bio: creator.user.profile?.bio ?? null,
      avatarUrl: creator.user.profile?.avatarUrl ?? null,
      plans: creator.plans.map((p) => ({
        id: p.id,
        name: p.name,
        priceJpy: p.priceJpy,
        billingInterval: p.billingInterval ?? 'month',
        isActive: p.isActive,
        sortOrder: p.sortOrder,
      })),
    };
  }
}
