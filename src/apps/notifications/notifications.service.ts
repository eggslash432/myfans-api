// api/src/apps/notifications/notifications.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationSource, NotificationType } from '@prisma/client';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  // enum 追加時もここだけ追記でOK
  private readonly TYPE_SET = new Set<NotificationType>([
    'SYSTEM',
    'PAYMENT',
    'KYC',
    'REPORT',
    'POST',
    'ANNOUNCEMENT',
    'CREATOR',
  ]);

  private readonly SOURCE_SET = new Set<NotificationSource>([
    'SYSTEM',
    'ADMIN',
    'WEBHOOK',
  ]);

  /**
   * 旧string type を enum NotificationType に寄せる
   * - 既存呼び出し箇所の修正を段階的に進めるための互換層
   */
  private coerceType(type: NotificationType | string): NotificationType {
    // すでに enum ならそのまま
    if (this.TYPE_SET.has(type as NotificationType)) {
      return type as NotificationType;
    }

    const raw = typeof type === 'string' ? type : String(type ?? '');
    const t = raw.trim().toLowerCase();

    // 空は SYSTEM
    if (!t) return 'SYSTEM';

    // 既存の自由文字列をざっくり分類（必要に応じて追加）
    if (t.includes('kyc') || t.includes('identity') || t.includes('verification')) return 'KYC';
    if (t.includes('pay') || t.includes('stripe') || t.includes('payment') || t.includes('invoice') || t.includes('payout')) return 'PAYMENT';
    if (t.includes('report') || t.includes('abuse') || t.includes('moderation') || t.includes('freeze')) return 'REPORT';
    if (t.includes('post')) return 'POST';
    if (t.includes('announce') || t.includes('announcement') || t.includes('notice') || t.includes('cms')) return 'ANNOUNCEMENT';
    if (t.includes('creator') || t.includes('application') || t.includes('shop')) return 'CREATOR';

    return 'SYSTEM';
  }

  /**
   * source の互換変換
   * - undefined: 指定なし → SYSTEM に寄せる（運用上わかりやすい）
   * - null: 明示的に null を入れたいケースを許容（必要なければ常に SYSTEM でもOK）
   * - string: ざっくり分類
   */
  private coerceSource(
    source?: NotificationSource | string | null,
  ): NotificationSource | null {
    // 明示nullは null として保存できるようにする
    if (source === null) return null;

    // 未指定は SYSTEM 扱い
    if (source === undefined) return 'SYSTEM';

    // enum ならそのまま
    if (this.SOURCE_SET.has(source as NotificationSource)) {
      return source as NotificationSource;
    }

    const raw = typeof source === 'string' ? source : String(source ?? '');
    const s = raw.trim().toLowerCase();

    if (!s) return 'SYSTEM';
    if (s.includes('admin')) return 'ADMIN';
    if (s.includes('webhook')) return 'WEBHOOK';
    if (s.includes('system')) return 'SYSTEM';

    // 不明なら SYSTEM
    return 'SYSTEM';
  }

  async notify(params: {
    userId: string;
    type: NotificationType | string; // 互換
    source?: NotificationSource | string | null; // optional + null許容
    title: string;
    body: string;
  }) {
    const userId = String(params.userId ?? '').trim();
    if (!userId) throw new Error('notify: userId is required');

    const title = String(params.title ?? '').trim();
    const body = String(params.body ?? '').trim();

    return this.prisma.notification.create({
      data: {
        userId,
        type: this.coerceType(params.type),
        source: this.coerceSource(params.source),
        title,
        body,
      },
    });
  }

  async notifyMany(
    userIds: string[],
    params: {
      type: NotificationType | string; // 互換
      source?: NotificationSource | string | null;
      title: string;
      body: string;
    },
  ) {
    const ids = (userIds ?? []).map((x) => String(x ?? '').trim()).filter(Boolean);
    if (ids.length === 0) return;

    const type = this.coerceType(params.type);
    const source = this.coerceSource(params.source);

    const title = String(params.title ?? '').trim();
    const body = String(params.body ?? '').trim();

    await this.prisma.notification.createMany({
      data: ids.map((userId) => ({
        userId,
        type,
        source,
        title,
        body,
      })),
    });
  }
}
