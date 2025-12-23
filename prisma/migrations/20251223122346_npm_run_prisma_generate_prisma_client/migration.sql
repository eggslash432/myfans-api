/*
  Warnings:

  - Added the required column `targetType` to the `Payout` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "PayoutTargetType" AS ENUM ('CREATOR', 'SHOP');

-- AlterTable
ALTER TABLE "Payout" ADD COLUMN     "shopId" TEXT,
ADD COLUMN     "targetType" "PayoutTargetType" NOT NULL,
ALTER COLUMN "creatorId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Payout_targetType_payoutStatus_idx" ON "Payout"("targetType", "payoutStatus");

-- CreateIndex
CREATE INDEX "Payout_shopId_payoutStatus_idx" ON "Payout"("shopId", "payoutStatus");

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
