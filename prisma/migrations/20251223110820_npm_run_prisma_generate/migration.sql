-- AlterTable
ALTER TABLE "Transfer" ADD COLUMN     "shopId" TEXT;

-- CreateIndex
CREATE INDEX "Transfer_shopId_idx" ON "Transfer"("shopId");

-- CreateIndex
CREATE INDEX "Transfer_kind_shopId_idx" ON "Transfer"("kind", "shopId");

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE SET NULL ON UPDATE CASCADE;
