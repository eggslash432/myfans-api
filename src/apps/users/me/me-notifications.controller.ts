// api/src/apps/users/me/me-notifications.controller.ts
import {
  Controller,
  Get,
  Param,
  Patch,
  Req,
  UseGuards,
  Query,
  BadRequestException,
} from "@nestjs/common";
import { JwtAuthGuard } from "src/apps/auth/jwt-auth.guard";
import { PrismaService } from "src/apps/prisma/prisma.service";

@UseGuards(JwtAuthGuard)
@Controller("me/notifications")
export class MeNotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /me/notifications?unreadOnly=true&take=50&skip=0
   * -> { items, total }
   */
  @Get()
  async list(
    @Req() req: any,
    @Query("unreadOnly") unreadOnly?: string,
    @Query("take") takeStr?: string,
    @Query("skip") skipStr?: string,
  ) {
    const userId = req.user.id;

    const take = Math.min(Math.max(Number(takeStr ?? 50) || 50, 1), 200);
    const skip = Math.max(Number(skipStr ?? 0) || 0, 0);

    const where: any = { userId };
    if (unreadOnly === "1" || unreadOnly === "true") {
      where.readAt = null;
    }

    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take,
        skip,
        select: {
          id: true,
          userId: true,
          type: true,
          source: true,
          title: true,
          body: true,
          readAt: true,
          createdAt: true,
        },
      }),
      this.prisma.notification.count({ where }),
    ]);

    return { items, total };
  }

  /**
   * PATCH /me/notifications/:id/read
   * -> 更新後の通知オブジェクトを返す（フロントが差し替えできる）
   */
  @Patch(":id/read")
  async read(@Req() req: any, @Param("id") id: string) {
    const userId = req.user.id;

    // まず自分の通知か確認（他人のidを読ませない）
    const exists = await this.prisma.notification.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!exists) throw new BadRequestException("notification not found");

    // readAt をセット
    await this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
    });

    // 更新後を返す
    const item = await this.prisma.notification.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        type: true,
        source: true,
        title: true,
        body: true,
        readAt: true,
        createdAt: true,
      },
    });

    return item;
  }
}
