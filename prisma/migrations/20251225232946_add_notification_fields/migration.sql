/*
  Warnings:

  - Changed the type of `type` on the `Notification` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('SYSTEM', 'PAYMENT', 'KYC', 'REPORT', 'POST', 'ANNOUNCEMENT');

-- CreateEnum
CREATE TYPE "NotificationSource" AS ENUM ('SYSTEM', 'ADMIN', 'WEBHOOK');

-- 1) source 追加（既存行に値が必要ならデフォルト埋めも）
ALTER TABLE "Notification"
  ADD COLUMN "source" "NotificationSource";

-- 2) 新しい type カラムを一旦 nullable で追加
ALTER TABLE "Notification"
  ADD COLUMN "type_new" "NotificationType";

-- 3) 既存 TEXT の type から enum へマイグレーション
--    既存データ: 'creator_approved' などが入ってるので、適当にマッピングする。
UPDATE "Notification"
SET "type_new" =
  CASE
    WHEN "type" IN ('payment_succeeded', 'payment', 'paid') THEN 'PAYMENT'::"NotificationType"
    WHEN "type" IN ('kyc', 'kyc_submitted', 'kyc_approved', 'kyc_rejected') THEN 'KYC'::"NotificationType"
    WHEN "type" IN ('report', 'reported') THEN 'REPORT'::"NotificationType"
    WHEN "type" IN ('post', 'post_published') THEN 'POST'::"NotificationType"
    WHEN "type" IN ('announcement') THEN 'ANNOUNCEMENT'::"NotificationType"
    -- あなたの現状値: creator_approved は SYSTEM 扱いに寄せる（必要なら POST に変えてもOK）
    WHEN "type" IN ('creator_approved', 'creator_rejected') THEN 'SYSTEM'::"NotificationType"
    ELSE 'SYSTEM'::"NotificationType"
  END
WHERE "type_new" IS NULL;

-- 4) NULL が残ってないことを保証してから NOT NULL 制約
ALTER TABLE "Notification"
  ALTER COLUMN "type_new" SET NOT NULL;

-- 5) 旧カラムを落としてリネーム
ALTER TABLE "Notification"
  DROP COLUMN "type";

ALTER TABLE "Notification"
  RENAME COLUMN "type_new" TO "type";


-- CreateTable
CREATE TABLE "SiteAnnouncement" (
    "id" SERIAL NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "linkUrl" TEXT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteAnnouncement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "meta" JSONB,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessLog" (
    "id" SERIAL NOT NULL,
    "userId" TEXT,
    "role" TEXT,
    "ip" TEXT,
    "ua" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessLog_pkey" PRIMARY KEY ("id")
);
