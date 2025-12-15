// api/src/apps/users/me/me-notifications.controller.ts

import { Controller, Get, Param, Patch, Req, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "src/apps/auth/jwt-auth.guard";
import { PrismaService } from "src/apps/prisma/prisma.service";

@UseGuards(JwtAuthGuard)
@Controller('me/notifications')
export class MeNotificationsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Req() req: any) {
    const userId = req.user.id;
    const items = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    return { items };
  }

  @Patch(':id/read')
  async read(@Req() req: any, @Param('id') id: string) {
    const userId = req.user.id;
    await this.prisma.notification.updateMany({
      where: { id, userId },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }
}
