import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminOnlyGuard } from '../access-control/admin-only.guard';

type AnnouncementDto = {
  title: string;
  body: string;
  linkUrl?: string | null;
  bannerImageUrl?: string | null;
  startsAt?: string | null; // ISO string
  endsAt?: string | null;   // ISO string
  isEnabled?: boolean;
};

function parseDateOrNull(v?: string | null) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new BadRequestException('Invalid date');
  return d;
}

@UseGuards(JwtAuthGuard, AdminOnlyGuard)
@Controller('admin/announcements')
export class AdminAnnouncementsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list() {
    const items = await this.prisma.announcement.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return { items };
  }

  @Post()
  async create(@Body() dto: AnnouncementDto) {
    if (!dto.title?.trim()) throw new BadRequestException('title required');
    if (!dto.body?.trim()) throw new BadRequestException('body required');

    const startsAt = parseDateOrNull(dto.startsAt ?? null);
    const endsAt = parseDateOrNull(dto.endsAt ?? null);
    if (startsAt && endsAt && startsAt > endsAt) {
      throw new BadRequestException('startsAt must be <= endsAt');
    }

    const created = await this.prisma.announcement.create({
      data: {
        title: dto.title.trim(),
        body: dto.body.trim(),
        linkUrl: dto.linkUrl?.trim() || null,
        bannerImageUrl: dto.bannerImageUrl?.trim() || null,
        startsAt,
        endsAt,
        isEnabled: dto.isEnabled ?? true,
      },
    });
    return { item: created };
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: Partial<AnnouncementDto>) {
    const announcementId = Number(id);
    if (!Number.isFinite(announcementId)) throw new BadRequestException('invalid id');

    const startsAt = dto.startsAt !== undefined ? parseDateOrNull(dto.startsAt) : undefined;
    const endsAt = dto.endsAt !== undefined ? parseDateOrNull(dto.endsAt) : undefined;

    // startsAt/endsAt 両方を更新する時だけ整合チェック（片方更新はDB値と合わせては見ない簡易版）
    if (startsAt && endsAt && startsAt > endsAt) {
      throw new BadRequestException('startsAt must be <= endsAt');
    }

    const updated = await this.prisma.announcement.update({
      where: { id: announcementId },
      data: {
        title: dto.title?.trim(),
        body: dto.body?.trim(),
        linkUrl: dto.linkUrl === undefined ? undefined : (dto.linkUrl?.trim() || null),
        bannerImageUrl:
          dto.bannerImageUrl === undefined ? undefined : (dto.bannerImageUrl?.trim() || null),
        startsAt,
        endsAt,
        isEnabled: dto.isEnabled,
      },
    });
    return { item: updated };
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    const announcementId = Number(id);
    if (!Number.isFinite(announcementId)) throw new BadRequestException('invalid id');

    await this.prisma.announcement.delete({ where: { id: announcementId } });
    return { ok: true };
  }

  @Get('announcements/active')
  async active() {
    const now = new Date();
    const items = await this.prisma.announcement.findMany({
      where: {
        isEnabled: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 3,
    });
    return { items };
  }  
}
