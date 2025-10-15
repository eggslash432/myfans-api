// scripts/seed-dev.ts
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // ← 既存テストユーザーのメールに合わせて
  const email = 'user2@example.com';

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`User not found: ${email}`);

  // 役割がcreatorでない場合は変更（任意）
  if (user.role !== 'creator') {
    await prisma.user.update({
      where: { id: user.id },
      data: { role: 'creator' },
    });
  }

  // Creator を作成/更新（公開フラグON）
  await prisma.creator.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      publicName: 'テストクリエイター',
      isListed: true,
    },
    update: {
      publicName: 'テストクリエイター',
      isListed: true,
    },
  });

  // 購読プラン（1000円/月）を1つ作成（重複しないように名前でゆるく検索）
  const existing = await prisma.plan.findFirst({
    where: { creatorId: user.id, name: 'ベーシック' },
  });
  if (!existing) {
    await prisma.plan.create({
      data: {
        creatorId: user.id,
        name: 'ベーシック',
        priceJpy: 1000,
        isActive: true,
        description: '中間検収用のテストプラン',
      },
    });
  }

  // 任意：投稿も1件
  const hasPost = await prisma.post.findFirst({ where: { creatorId: user.id } });
  if (!hasPost) {
    await prisma.post.create({
      data: {
        creatorId: user.id,
        title: 'はじめまして！',
        bodyMd: 'ようこそMyFans Cloneへ',
        visibility: 'free',
        isPublished: true,
        publishedAt: new Date(),
      },
    });
  }

  console.log('Seed done ✅');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});
