// scripts/seed_ppv_post.js
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  try {
    // 1) 対象ユーザー（先に /auth/signup 済み前提）
    const email = process.env.SEED_USER_EMAIL || 'creator1@example.com';
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error(`seed user not found: ${email}（先に /auth/signup してください）`);

    // 2) Creator を userId で upsert（Creator の主キーは userId）
    const creator = await prisma.creator.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id, publicName: 'クリエイター太郎' },
      select: { userId: true },
    });

    // 3) PPV 投稿を作成
    //    - 本文は bodyMd
    //    - PPVは visibility='paid_single' + priceJpy
    //    - 公開するなら isPublished=true, publishedAt=now
    const post = await prisma.post.create({
      data: {
        title: 'PPVテスト投稿',
        bodyMd: '本文だよ（Markdown）',
        visibility: 'paid_single',    // enum Visibility { free, plan, paid_single }
        priceJpy: 300,                // 100以上の整数
        isPublished: true,
        publishedAt: new Date(),
        creator: { connect: { userId: creator.userId } },
      },
      select: { id: true },
    });

    console.log('ppvPostId:', post.id);
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
})();
