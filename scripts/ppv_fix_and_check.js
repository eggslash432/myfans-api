// scripts/ppv_fix_and_check.js
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  try {
    const USER_ID = process.env.USER_ID;   // 閲覧に使うJWTの /auth/me の id
    const POST_ID = process.env.POST_ID;   // 閲覧対象のPPV投稿 id
    if (!USER_ID || !POST_ID) throw new Error('USER_ID / POST_ID を環境変数で指定してください');

    // 1) Post を取得＆公開状態に補正
    let post = await prisma.post.findUnique({ where: { id: POST_ID } });
    if (!post) throw new Error(`Post not found: ${POST_ID}`);

    const patch = {};
    if (post.visibility !== 'paid_single') patch.visibility = 'paid_single';
    if (!post.isPublished) patch.isPublished = true;
    if (!post.publishedAt || new Date(post.publishedAt) > new Date()) patch.publishedAt = new Date();
    if (!post.priceJpy || post.priceJpy < 100) patch.priceJpy = 300; // 最低300円に補正

    if (Object.keys(patch).length) {
      post = await prisma.post.update({ where: { id: POST_ID }, data: patch });
      console.log('[fix] Post updated:', patch);
    }

    // 2) Payment を確認（ユーザー×投稿の最新）
    let pay = await prisma.payment.findFirst({
      where: { userId: USER_ID, postId: POST_ID },
      orderBy: { createdAt: 'desc' },
    });

    // 3) Payment を upsert（不足があれば作る/直す）
    const amount = Math.max(post.priceJpy || 300, 100);
    if (!pay) {
      pay = await prisma.payment.create({
        data: {
          userId: USER_ID,
          creatorId: post.creatorId, // Creator.userId
          postId: POST_ID,
          amountJpy: amount,
          kind: 'one_time',
          status: 'paid',
          externalTxId: `manual:${POST_ID}:${USER_ID}:${Date.now()}`,
          paidAt: new Date(),
        },
      });
      console.log('[fix] Payment created:', pay.id);
    } else {
      const need = {};
      if (pay.status !== 'paid') need.status = 'paid';
      if (pay.kind !== 'one_time') need.kind = 'one_time';
      if (!pay.paidAt) need.paidAt = new Date();
      if (!pay.amountJpy || pay.amountJpy < amount) need.amountJpy = amount;
      if (!pay.creatorId) need.creatorId = post.creatorId;

      if (Object.keys(need).length) {
        pay = await prisma.payment.update({ where: { id: pay.id }, data: need });
        console.log('[fix] Payment updated:', need);
      }
    }

    // 4) 最終確認のダイジェストを出力
    console.log('\n=== SUMMARY ===');
    console.log({
      post_pick: { id: post.id, visibility: post.visibility, isPublished: post.isPublished, publishedAt: post.publishedAt, priceJpy: post.priceJpy, creatorId: post.creatorId },
      payment_pick: { id: pay.id, userId: pay.userId, postId: pay.postId, kind: pay.kind, status: pay.status, amountJpy: pay.amountJpy, paidAt: pay.paidAt },
      note: 'この状態で GET /posts/:id は 200 になるはず（JWT は USER_ID のものを使用）',
    });

    await prisma.$disconnect();
  } catch (e) {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  }
})();
