import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePlanDto } from './dto/create-plan.dto';
import { Role } from '@prisma/client';

@Injectable()
export class PlansService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreatePlanDto) {
    // ユーザーが Creator か確認
    const creator = await this.prisma.creator.findUnique({ where: { userId } });
    if (!creator) throw new ForbiddenException('クリエイター登録が必要です');

    return this.prisma.plan.create({
      data: {
        creatorId: userId,
        name: dto.name,
        priceJpy: dto.priceJpy,
        description: dto.description ?? null,
      },
    });
  }

  async findByCreator(userId: string) {
    return this.prisma.plan.findMany({
      where: { creatorId: userId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
  }
}
