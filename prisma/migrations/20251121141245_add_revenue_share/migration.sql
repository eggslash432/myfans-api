-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "creatorAmountJpy" INTEGER,
ADD COLUMN     "platformAmountJpy" INTEGER;

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "creatorSharePercent" INTEGER NOT NULL DEFAULT 80,
ADD COLUMN     "platformSharePercent" INTEGER NOT NULL DEFAULT 20;
