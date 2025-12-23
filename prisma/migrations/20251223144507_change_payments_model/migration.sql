-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "shopAmountJpy" INTEGER,
ADD COLUMN     "shopId" TEXT;

-- CreateIndex
CREATE INDEX "Payment_shopId_idx" ON "Payment"("shopId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE SET NULL ON UPDATE CASCADE;
