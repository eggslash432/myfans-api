// api/src/apps/notifications/notifications.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationSource, NotificationType } from '@prisma/client';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 旧string type を enum NotificationType に寄せる
   * ここで吸収しておくと、既存呼び出し箇所の修正を段階的に進められる
   */
  private coerceType(type: NotificationType | string): NotificationType {
    // すでに enum 値ならそのまま
    if (
      type === 'SYSTEM' ||
      type === 'PAYMENT' ||
      type === 'KYC' ||
      type === 'REPORT' ||
      type === 'POST' ||
      type === 'ANNOUNCEMENT' ||
      type === 'CREATOR'
    ) {
      return type;
    }

    const t = String(type ?? '').toLowerCase();

    // 既存の自由文字列をざっくり分類（必要に応じて追加）
    if (t.includes('kyc') || t.includes('identity')) return 'KYC';
    if (t.includes('pay') || t.includes('stripe') || t.includes('payment')) return 'PAYMENT';
    if (t.includes('report') || t.includes('abuse')) return 'REPORT';
    if (t.includes('post')) return 'POST';
    if (t.includes('announce') || t.includes('notice')) return 'ANNOUNCEMENT';
    if (t.includes('creator') || t.includes('application') || t.includes('shop')) return 'CREATOR';

    return 'SYSTEM';
  }

  private coerceSource(source?: NotificationSource | string | null): NotificationSource {
    if (source === 'SYSTEM' || source === 'ADMIN' || source === 'WEBHOOK') return source;
    const s = String(source ?? '').toLowerCase();
    if (s.includes('admin')) return 'ADMIN';
    if (s.includes('webhook')) return 'WEBHOOK';
    return 'SYSTEM';
  }

  async notify(params: {
    userId: string;
    type: NotificationType | string; // ← 互換: stringもOK
    source?: NotificationSource | string; // ← optional
    title: string;
    body: string;
  }) {
    return this.prisma.notification.create({
      data: {
        userId: params.userId,
        type: this.coerceType(params.type),
        source: this.coerceSource(params.source),
        title: params.title,
        body: params.body,
      },
    });
  }

  async notifyMany(
    userIds: string[],
    params: {
      type: NotificationType | string; // ← 互換
      source?: NotificationSource | string;
      title: string;
      body: string;
    },
  ) {
    if (userIds.length === 0) return;

    const type = this.coerceType(params.type);
    const source = this.coerceSource(params.source);

    await this.prisma.notification.createMany({
      data: userIds.map((userId) => ({
        userId,
        type,
        source,
        title: params.title,
        body: params.body,
      })),
    });
  }
}
