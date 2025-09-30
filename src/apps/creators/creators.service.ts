import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCreatorDto } from './dto/create-creator.dto';
import { KycStatus, Role } from '@prisma/client';

@Injectable()
export class CreatorsService {
  constructor(private prisma: PrismaService) {}

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
}
