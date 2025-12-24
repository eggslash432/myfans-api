/*
  Warnings:

  - The `status` column on the `Report` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- DropIndex
DROP INDEX "Payment_creatorId_idx";

-- DropIndex
DROP INDEX "Payment_paymentStatus_createdAt_idx";

-- DropIndex
DROP INDEX "Payment_planId_idx";

-- DropIndex
DROP INDEX "Payment_postId_idx";

-- DropIndex
DROP INDEX "Payment_shopId_idx";

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "stripeFeeJpy" INTEGER;

-- AlterTable
ALTER TABLE "Report" DROP COLUMN "status",
ADD COLUMN     "status" "ReportStatus" NOT NULL DEFAULT 'pending';

-- CreateTable
CREATE TABLE "PayoutItem" (
    "id" TEXT NOT NULL,
    "payoutId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "amountJpy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayoutItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayoutItem_paymentId_idx" ON "PayoutItem"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutItem_payoutId_paymentId_key" ON "PayoutItem"("payoutId", "paymentId");

-- CreateIndex
CREATE INDEX "Payment_paymentStatus_paidAt_idx" ON "Payment"("paymentStatus", "paidAt");

-- CreateIndex
CREATE INDEX "Payment_creatorId_paymentStatus_paidAt_idx" ON "Payment"("creatorId", "paymentStatus", "paidAt");

-- CreateIndex
CREATE INDEX "Payment_shopId_paymentStatus_paidAt_idx" ON "Payment"("shopId", "paymentStatus", "paidAt");

-- AddForeignKey
ALTER TABLE "PayoutItem" ADD CONSTRAINT "PayoutItem_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutItem" ADD CONSTRAINT "PayoutItem_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
