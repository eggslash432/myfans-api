// api/src/apps/help/help.service.ts

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateHelpArticleDto, UpdateHelpArticleDto } from './dto/help-article.dto';

@Injectable()
export class HelpService {
  constructor(private readonly prisma: PrismaService) {}

  async listPublic() {
    return this.prisma.helpArticle.findMany({
      where: { isPublished: true },
      orderBy: [{ category: 'asc' }, { order: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        slug: true,
        title: true,
        category: true,
        order: true,
        updatedAt: true,
      },
    });
  }

  async getPublicBySlug(slug: string) {
    const item = await this.prisma.helpArticle.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        title: true,
        body: true,
        category: true,
        order: true,
        updatedAt: true,
        isPublished: true,
      },
    });
    if (!item || !item.isPublished) throw new NotFoundException('記事が見つかりません');
    return item;
  }

  async listAdmin() {
    return this.prisma.helpArticle.findMany({
      orderBy: [{ category: 'asc' }, { order: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async createAdmin(dto: CreateHelpArticleDto) {
    // slug重複は unique で落ちるが、分かりやすく弾く
    const exists = await this.prisma.helpArticle.findUnique({ where: { slug: dto.slug } });
    if (exists) throw new BadRequestException('slugが既に存在します');

    return this.prisma.helpArticle.create({
      data: {
        slug: dto.slug,
        title: dto.title,
        body: dto.body,
        category: dto.category ?? null,
        order: dto.order ?? 0,
        isPublished: dto.isPublished ?? false,
      },
    });
  }

  async updateAdmin(id: string, dto: UpdateHelpArticleDto) {
    const exists = await this.prisma.helpArticle.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('記事が見つかりません');

    return this.prisma.helpArticle.update({
      where: { id },
      data: {
        ...dto,
        category: dto.category === undefined ? undefined : dto.category ?? null,
      },
    });
  }

  async deleteAdmin(id: string) {
    await this.prisma.helpArticle.delete({ where: { id } });
    return { ok: true };
  }
}
