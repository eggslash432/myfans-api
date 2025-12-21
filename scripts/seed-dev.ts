// scripts/seed-dev.ts
/// <reference types="node" />
import { PrismaClient, PublishedStatus, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function upsertUser(
  email: string,
  role: Role,
  passwordPlain = 'password'
) {
  const passwordHash = await bcrypt.hash(passwordPlain, 10);

  return prisma.user.upsert({
    where: { email },
    update: {
      role,
      passwordHash,
      isActive: true,
    },
    create: {
      email,
      role,
      passwordHash,
    },
    select: { id: true, email: true, role: true },
  });
}

async function upsertCreatorForUser(userId: string, publicName: string) {
  return prisma.creator.upsert({
    where: { userId },
    update: { publicName, isListed: true },
    create: {
      userId,
      publicName,
      isListed: true,
      approvalStatus: 'approved',
    },
    select: { userId: true, publicName: true },
  });
}

async function main() {
  // 1) 一般ユーザー
  const fan = await upsertUser(
    'user1@example.com',
    Role.user,
    'userpass'
  );

  // 2) クリエイター用ユーザー（role は user のまま）
  const creatorUser = await upsertUser(
    'user2@example.com',
    Role.user,
    'creatorpass'
  );

  // 3) Creator レコードを作る（ここが分岐点）
  const creator = await upsertCreatorForUser(
    creatorUser.id,
    'demo-creator'
  );

  // 4) プラン
  const basicPlan = await prisma.plan.upsert({
    where: { id: 'basic-plan-1' },
    update: { isActive: true },
    create: {
      id: 'basic-plan-1',
      creatorId: creator.userId,
      name: 'Basic Plan',
      priceJpy: 980,
      isActive: true,
    },
  });

  // 5) 無料投稿
  await prisma.post.create({
    data: {
      creatorId: creator.userId,
      title: 'ようこそ MyFans Clone へ',
      body: 'これはシードデータの最初の投稿です。',
      visibility: 'free',
      publishedStatus: PublishedStatus.published,
      publishedAt: new Date(),
    },
  });

  // 6) 下書き投稿
  await prisma.post.create({
    data: {
      creatorId: creator.userId,
      title: '有料投稿（プラン向け）',
      body: 'プラン加入者のみ閲覧できます。',
      visibility: 'plan',
      publishedStatus: PublishedStatus.draft,
    },
  });

  console.log('✅ Seed completed');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
