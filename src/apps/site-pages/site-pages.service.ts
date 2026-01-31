// api/src/site-pages/site-pages.service.ts
import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class SitePagesService {
  constructor(private prisma: PrismaService) {}

  async getPublishedBySlug(slug: string) {
    return this.prisma.sitePage.findFirst({
      where: { slug, published: true },
      select: { slug: true, title: true, body: true, updatedAt: true },
    });
  }

  async getBySlug(slug: string) {
    return this.prisma.sitePage.findUnique({ where: { slug } });
  }

  async upsertBySlug(
    slug: string,
    data: { title?: string; body?: string; published?: boolean }
  ) {
    return this.prisma.sitePage.upsert({
      where: { slug },
      update: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.body !== undefined ? { body: data.body } : {}),
        ...(data.published !== undefined ? { published: data.published } : {}),
      },
      create: {
        slug,
        title: data.title ?? slug,
        body: data.body ?? "",
        published: data.published ?? true,
      },
    });
  }
}
