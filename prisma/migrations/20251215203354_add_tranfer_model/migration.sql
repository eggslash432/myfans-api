-- CreateEnum
CREATE TYPE "TransferKind" AS ENUM ('shop', 'creator');

-- CreateTable
CREATE TABLE "Transfer" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "kind" "TransferKind" NOT NULL,
    "amountJpy" INTEGER NOT NULL,
    "destinationAcct" TEXT NOT NULL,
    "stripeTransferId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Transfer_stripeTransferId_key" ON "Transfer"("stripeTransferId");

-- CreateIndex
CREATE INDEX "Transfer_paymentId_idx" ON "Transfer"("paymentId");
