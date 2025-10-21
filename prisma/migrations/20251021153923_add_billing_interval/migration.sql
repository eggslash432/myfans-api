/*
  Warnings:

  - You are about to drop the column `BillingInterval` on the `Plan` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Plan" DROP COLUMN "BillingInterval",
ADD COLUMN     "billingInterval" "BillingInterval" NOT NULL DEFAULT 'month';
