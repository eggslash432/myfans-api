// api/src/apps/legal/legal.service.ts

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AgreeLegalDto, LegalDocumentTypeDto } from './dto/legal.dto';

@Injectable()
export class LegalService {
  constructor(private readonly prisma: PrismaService) {}

  async getLatest(type: LegalDocumentTypeDto) {
    const doc = await this.prisma.legalDocument.findFirst({
      where: {
        type: type as any,
        publishedAt: { not: null },
      },
      orderBy: [{ version: 'desc' }],
    });
    if (!doc) throw new NotFoundException('公開中のドキュメントがありません');
    return doc;
  }

  async agree(userId: string, ip: string | undefined, dto: AgreeLegalDto) {
    const latest = await this.getLatest(dto.type);

    // クライアントが version を送ってきた場合は一致必須（古い画面で同意させない）
    if (dto.version !== undefined && dto.version !== latest.version) {
      throw new BadRequestException('最新版の規約に更新されています。再読み込みしてください。');
    }

    // 既に同意済みなら再作成しない（idempotent）
    const existing = await this.prisma.userAgreement.findFirst({
      where: { userId, type: latest.type, version: latest.version },
    });
    if (existing) return existing;

    return this.prisma.userAgreement.create({
      data: {
        userId,
        documentId: latest.id,
        type: latest.type,
        version: latest.version,
        ip: ip ?? null,
        userAgent: dto.userAgent ?? null,
      },
    });
  }

  async listAgreements(userId: string) {
    return this.prisma.userAgreement.findMany({
      where: { userId },
      orderBy: { agreedAt: 'desc' },
      include: {
        document: { select: { id: true, type: true, version: true, title: true, publishedAt: true } },
      },
    });
  }
}
