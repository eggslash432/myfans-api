/*
  Warnings:

  - You are about to drop the column `status` on the `Payment` table. All the data in the column will be lost.
  - You are about to drop the column `status` on the `Payout` table. All the data in the column will be lost.
  - You are about to drop the column `bodyMd` on the `Post` table. All the data in the column will be lost.
  - You are about to drop the column `isPublished` on the `Post` table. All the data in the column will be lost.
  - Added the required column `paymentStatus` to the `Payment` table without a default value. This is not possible if the table is not empty.
  - Added the required column `payoutStatus` to the `Payout` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "PublishedStatus" AS ENUM ('draft', 'published', 'private');

-- DropIndex
DROP INDEX "public"."Payment_status_createdAt_idx";

-- DropIndex
DROP INDEX "public"."Payout_creatorId_status_idx";

-- DropIndex
DROP INDEX "public"."Post_creatorId_isPublished_idx";

-- AlterTable
ALTER TABLE "Payment" DROP COLUMN "status",
ADD COLUMN     "paymentStatus" "PaymentStatus" NOT NULL;

-- AlterTable
ALTER TABLE "Payout" DROP COLUMN "status",
ADD COLUMN     "payoutStatus" "PayoutStatus" NOT NULL;

-- AlterTable
ALTER TABLE "Post" DROP COLUMN "bodyMd",
DROP COLUMN "isPublished",
ADD COLUMN     "body" TEXT,
ADD COLUMN     "publishedStatus" "PublishedStatus" NOT NULL DEFAULT 'draft';

-- CreateIndex
CREATE INDEX "Payment_paymentStatus_createdAt_idx" ON "Payment"("paymentStatus", "createdAt");

-- CreateIndex
CREATE INDEX "Payout_creatorId_payoutStatus_idx" ON "Payout"("creatorId", "payoutStatus");

-- CreateIndex
CREATE INDEX "Post_creatorId_publishedStatus_idx" ON "Post"("creatorId", "publishedStatus");
