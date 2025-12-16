-- AlterEnum
ALTER TYPE "TransferKind" ADD VALUE 'platform';

-- AlterTable
ALTER TABLE "Transfer" ALTER COLUMN "stripeTransferId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
