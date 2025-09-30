import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCreatorDto } from './dto/create-creator.dto';
import { KycStatus, Role } from '@prisma/client';

@Injectable()
export class CreatorsService {
  constructor(private prisma: PrismaService) {}

  async applyCreator(userIdRaw: string | number, dto: CreateCreatorDto) {
    // Prisma の User.id は Int なので数値に寄せる
    const userId = Number(userIdRaw);

    if (Number.isNaN(userId)) {
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
        publicName: dto.publicName ?? dto.displayName ?? '',
        bankAccount: dto.bankAccount ?? undefined,
        // isListed は初期 false（審査後に true へ）
      },
    });

    // Profile（任意）更新：displayName/bio が来ていれば反映
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

    // KYC 申請（任意）を同時に作る
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
