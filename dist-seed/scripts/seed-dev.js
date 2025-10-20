"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
// scripts/seed-dev.ts
/// <reference types="node" />
const client_1 = require("@prisma/client");
const bcrypt = __importStar(require("bcryptjs"));
const prisma = new client_1.PrismaClient();
async function upsertUser(email, role, passwordPlain = 'password') {
    const passwordHash = await bcrypt.hash(passwordPlain, 10);
    // emailユニーク前提で upsert（idはDB側で採番/uuid）
    const user = await prisma.user.upsert({
        where: { email },
        update: {
            role,
            passwordHash, // 既存ユーザーでもパスワードを更新
            isActive: true,
        },
        create: { email, role, passwordHash },
        select: { id: true, email: true, role: true },
    });
    return user;
}
async function upsertCreatorForUser(userId, publicName) {
    // userIdがstringの想定（schemaに合わせて）
    return prisma.creator.upsert({
        where: { userId }, // @unique
        update: { publicName, isListed: true },
        create: { userId, publicName, isListed: true },
        select: { userId: true, publicName: true },
    });
}
async function main() {
    // 1) ユーザー（ファン/クリエイター）を用意
    const fan = await upsertUser('user1@example.com', 'fan', 'userpass'); // ログイン用
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
            visibility: 'free', // schemaがenumなら対応enumに変更
            priceJpy: null,
            publishedStatus: client_1.PublishedStatus.published, // ← enum を使う
            publishedAt: new Date(),
        },
    });
    // 5) 有料投稿（任意）
    await prisma.post.create({
        data: {
            creatorId: creator.userId,
            title: '有料投稿（プラン向け）',
            body: 'プラン加入者のみ閲覧できます。',
            visibility: 'plan', // schemaに合わせて 'plan' / 'paid_single'
            priceJpy: null,
            publishedStatus: client_1.PublishedStatus.draft, // 下書き
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
