// api/src/apps/notifications/notifications.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async notify(params: {
    userId: string;
    type: string;
    title: string;
    body: string;
  }) {
    return this.prisma.notification.create({
      data: {
        userId: params.userId,
        type: params.type,
        title: params.title,
        body: params.body,
      },
    });
  }

  async notifyMany(
    userIds: string[],
    params: {
      type: string;
      title: string;
      body: string;
    },
  ) {
    if (userIds.length === 0) return;

    await this.prisma.notification.createMany({
      data: userIds.map((userId) => ({
        userId,
        type: params.type,
        title: params.title,
        body: params.body,
      })),
    });
  }  
}
