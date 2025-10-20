// scripts/seed-dev.ts
/// <reference types="node" />
import { PrismaClient, PublishedStatus, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function upsertUser(email: string, role: Role, passwordPlain = 'password') {
  const passwordHash = await bcrypt.hash(passwordPlain, 10);
  // emailユニーク前提で upsert（idはDB側で採番/uuid）
  const user = await prisma.user.upsert({
    where: { email },
    update: {                     // ← ここを空にしない！
      role,
      passwordHash,              // 既存ユーザーでもパスワードを更新
      isActive: true,
    },
    create: { email, role, passwordHash },
    select: { id: true, email: true, role: true },
  });
  return user;
}

async function upsertCreatorForUser(userId: string, publicName: string) {
  // userIdがstringの想定（schemaに合わせて）
  return prisma.creator.upsert({
    where: { userId },       // @unique
    update: { publicName, isListed: true },
    create: { userId, publicName, isListed: true },
    select: { userId: true, publicName: true },
  });
}

async function main() {
  // 1) ユーザー（ファン/クリエイター）を用意
  const fan = await upsertUser('user1@example.com', 'fan', 'userpass');            // ログイン用
  const creatorUser = await upsertUser('user2@example.com', 'creator', 'creatorpass');

  // 2) クリエイター行（1:1）
  const creator = await upsertCreatorForUser(creatorUser.id, 'demo-creator');

  // 3) プラン（任意：存在チェックして1件用意）
  const basicPlan = await prisma.plan.upsert({
    where: { id: 'basic-plan-1' }, // 文字ID運用の例。数値なら別ロジックでOK
    update: { isActive: true },
    create: {
      id: 'basic-plan-1',
      creatorId: creator.userId,
      name: 'Basic Plan',
      priceJpy: 980,
      isActive: true,
    },
    select: { id: true, name: true, priceJpy: true, isActive: true },
  });

  // 4) 投稿（無料1件 + 公開済み）
  await prisma.post.create({
    data: {
      creatorId: creator.userId,
      title: 'ようこそ MyFans Clone へ',
      body: 'これはシードデータの最初の投稿です。',
      visibility: 'free',                         // schemaがenumなら対応enumに変更
      priceJpy: null,
      publishedStatus: PublishedStatus.published, // ← enum を使う
      publishedAt: new Date(),
    },
  });

  // 5) 有料投稿（任意）
  await prisma.post.create({
    data: {
      creatorId: creator.userId,
      title: '有料投稿（プラン向け）',
      body: 'プラン加入者のみ閲覧できます。',
      visibility: 'plan',                         // schemaに合わせて 'plan' / 'paid_single'
      priceJpy:  null,
      publishedStatus: PublishedStatus.draft,     // 下書き
      publishedAt: null,
    },
  });

  console.log('✅ Seed completed:', {
    fan,
    creatorUser,
    creator,
    basicPlan,
  });
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
