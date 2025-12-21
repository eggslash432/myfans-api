// api/src/apps/creators/apply/creator-apply.service.ts

import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCreatorDto } from '../dto/create-creator.dto';

@Injectable()
export class CreatorApplyService {
  constructor(private readonly prisma: PrismaService) {}

  async applyCreator(userIdRaw: string, dto: CreateCreatorDto) {
    const userId = String(userIdRaw);
    if (!userId) throw new BadRequestException('invalid user id: ' + userIdRaw);

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('user not found: ' + userId);

    const publicName =
      dto.publicName ?? dto.displayName ?? user.email?.split('@')[0];

    if (!publicName) {
      throw new BadRequestException('publicName または displayName を指定してください');
    }

    const creator = await this.prisma.creator.upsert({
      where: { userId },
      update: {
        publicName,
        bankAccount: dto.bankAccount ?? undefined,
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

    await this.prisma.creatorApplication.create({
      data: {
        userId,
        publicName,
        bankAccount: dto.bankAccount ?? undefined,
        status: 'pending' as any,
      },
    });

    return creator;
  }
}
