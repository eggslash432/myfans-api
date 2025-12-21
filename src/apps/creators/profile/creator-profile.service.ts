// api/src/apps/creators/profile/creator-profile.service.ts

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateCreatorProfileDto } from '../dto/update-creator-profile.dto';

@Injectable()
export class CreatorProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async updateProfile(userId: string, dto: UpdateCreatorProfileDto) {
    const creator = await this.prisma.creator.findUnique({ where: { userId } });
    if (!creator) throw new NotFoundException('creator not found: ' + userId);

    if (dto.publicName !== undefined) {
      await this.prisma.creator.update({
        where: { userId },
        data: { publicName: dto.publicName },
      });
    }

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

    // 呼び出し元（CreatorsService）が getMe を返すならここでは返さないでもOK
    return { ok: true };
  }
}
