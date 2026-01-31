// api/src/apps/notifications/notifications.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  NotificationSource,
  NotificationType,
  Prisma,
  Notification, // ✅ 追加
} from '@prisma/client';

type NotifySkipped = { readonly skipped: true; readonly reason: 'inAppDisabled' };

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

  /** Prismaの複合ユニーク(where)を型安全に返す */
  private whereSetting(
    userId: string,
    type: NotificationType,
  ): Prisma.NotificationSettingWhereUniqueInput {
    return { userId_type: { userId, type } };
  }

  /** 設定が無ければ作る（schema defaultに従う：inApp=true, email=false） */
  private async ensureSetting(userId: string, type: NotificationType) {
    await this.prisma.notificationSetting.createMany({
      data: [{ userId, type }],
      skipDuplicates: true,
    });
  }

  /** 設定を取得（必ず存在させた上で返す） */
  private async getSetting(userId: string, type: NotificationType) {
    await this.ensureSetting(userId, type);
    return this.prisma.notificationSetting.findUnique({
      where: this.whereSetting(userId, type),
    });
  }

  /** in-appが有効か（デフォルト有効） */
  private async isInAppEnabled(
    userId: string,
    type: NotificationType,
  ): Promise<boolean> {
    const setting = await this.getSetting(userId, type);
    return setting?.inAppEnabled !== false;
  }

  /** emailが有効か（デフォルト無効：schema通り） */
  private async isEmailEnabled(
    userId: string,
    type: NotificationType,
  ): Promise<boolean> {
    const setting = await this.getSetting(userId, type);
    return setting?.emailEnabled === true;
  }

  /**
   * 旧string type を enum NotificationType に寄せる
   * - 既存呼び出し箇所の修正を段階的に進めるための互換層
   */
  private coerceType(type: NotificationType | string): NotificationType {
    if (this.TYPE_SET.has(type as NotificationType)) return type as NotificationType;

    const raw = typeof type === 'string' ? type : String(type ?? '');
    const t = raw.trim().toLowerCase();

    if (!t) return 'SYSTEM';

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
    if (source === null) return null;
    if (source === undefined) return 'SYSTEM';
    if (this.SOURCE_SET.has(source as NotificationSource)) {
      return source as NotificationSource;
    }

    const raw = typeof source === 'string' ? source : String(source ?? '');
    const s = raw.trim().toLowerCase();

    if (!s) return 'SYSTEM';
    if (s.includes('admin')) return 'ADMIN';
    if (s.includes('webhook')) return 'WEBHOOK';
    if (s.includes('system')) return 'SYSTEM';

    return 'SYSTEM';
  }

  // ✅ overload: force:true のときは必ず Notification を返す
  async notify(params: {
    userId: string;
    type: NotificationType | string;
    source?: NotificationSource | string | null;
    title: string;
    body: string;
    force: true;
  }): Promise<Notification>;

  // ✅ overload: 通常は skipped の可能性あり
  async notify(params: {
    userId: string;
    type: NotificationType | string;
    source?: NotificationSource | string | null;
    title: string;
    body: string;
    force?: false | undefined;
  }): Promise<Notification | NotifySkipped>;

  // ✅ 実装本体
  async notify(params: {
    userId: string;
    type: NotificationType | string;
    source?: NotificationSource | string | null;
    title: string;
    body: string;
    force?: boolean;
  }): Promise<Notification | NotifySkipped> {
    const userId = String(params.userId ?? '').trim();
    if (!userId) throw new Error('notify: userId is required');

    const type = this.coerceType(params.type);
    const source = this.coerceSource(params.source);

    const title = String(params.title ?? '').trim();
    const body = String(params.body ?? '').trim();

    // ✅ force=true ならスキップしない
    if (!params.force) {
      const inAppOk = await this.isInAppEnabled(userId, type);
      if (!inAppOk) {
        return { skipped: true, reason: 'inAppDisabled' } as const;
      }
    }

    // メールは設定に従う（forceでメールまで強制したいなら別途）
    const emailOk = await this.isEmailEnabled(userId, type);
    if (emailOk) {
      console.log('[MAIL_STUB]', { userId, type, title });
    }

    return this.prisma.notification.create({
      data: { userId, type, source, title, body },
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

    // まず全員分の setting 行を作る（高速）
    await this.prisma.notificationSetting.createMany({
      data: ids.map((userId) => ({ userId, type })),
      skipDuplicates: true,
    });

    // inAppEnabled=false を除外
    const settings = await this.prisma.notificationSetting.findMany({
      where: { userId: { in: ids }, type },
      select: { userId: true, inAppEnabled: true, emailEnabled: true },
    });

    const disabled = new Set(
      settings.filter((s) => s.inAppEnabled === false).map((s) => s.userId),
    );
    const enabledIds = ids.filter((id) => !disabled.has(id));
    if (enabledIds.length === 0) return;

    const emailTargets = settings
      .filter((s) => s.emailEnabled === true && !disabled.has(s.userId))
      .map((s) => s.userId);

    if (emailTargets.length > 0) {
      console.log('[MAIL_STUB_MANY]', { type, count: emailTargets.length, title });
    }

    await this.prisma.notification.createMany({
      data: enabledIds.map((userId) => ({
        userId,
        type,
        source,
        title,
        body,
      })),
    });
  }
}
