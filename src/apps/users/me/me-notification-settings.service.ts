// api/src/apps/users/me/me-notification-settings.service.ts
import { Injectable, BadRequestException } from "@nestjs/common";
import { Prisma, PrismaClient, NotificationType } from "@prisma/client";
import { PrismaService } from "src/apps/prisma/prisma.service";
import { UpdateNotificationSettingsDto } from "./dto/update-notification-settings.dto";

@Injectable()
export class MeNotificationSettingsService {
  constructor(private prisma: PrismaService) {}

  /** PrismaのAtLeast型対策：idキーも含める（undefinedでOK） */
  private where(userId: string, type: NotificationType): Prisma.NotificationSettingWhereUniqueInput {
    return {
      id: undefined,
      userId_type: { userId, type },
    };
  }

  /** ユーザーの設定行を全type分、存在しなければ作る */
  async ensureAll(userId: string) {
    const types = Object.values(NotificationType);

    // createMany + skipDuplicates で一気に作る（既存はスキップ）
    await this.prisma.notificationSetting.createMany({
      data: types.map((type) => ({ userId, type })),
      skipDuplicates: true,
    });
  }

  /** 一覧（全type） */
  async list(userId: string) {
    await this.ensureAll(userId);
    return this.prisma.notificationSetting.findMany({
      where: { userId },
      orderBy: { type: "asc" },
    });
  }

  /** 1件更新（type指定） */
  async updateOne(userId: string, type: NotificationType, dto: UpdateNotificationSettingsDto) {
    await this.ensureAll(userId);

    return this.prisma.notificationSetting.update({
      where: this.where(userId, type),
      data: dto,
    });
  }
}
