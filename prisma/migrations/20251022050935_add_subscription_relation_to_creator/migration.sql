/*
  Warnings:

  - You are about to drop the column `externalSubId` on the `Subscription` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[stripeSubscriptionId]` on the table `Subscription` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[userId,creatorId,planId]` on the table `Subscription` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `creatorId` to the `Subscription` table without a default value. This is not possible if the table is not empty.
  - Added the required column `stripeSubscriptionId` to the `Subscription` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "CheckoutMode" AS ENUM ('payment', 'subscription');

-- DropIndex
DROP INDEX "public"."Subscription_userId_planId_key";

-- AlterTable
ALTER TABLE "Subscription" DROP COLUMN "externalSubId",
ADD COLUMN     "creatorId" TEXT NOT NULL,
ADD COLUMN     "stripeSubscriptionId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_stripeSubscriptionId_key" ON "Subscription"("stripeSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_userId_creatorId_planId_key" ON "Subscription"("userId", "creatorId", "planId");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "Creator"("userId") ON DELETE CASCADE ON UPDATE CASCADE;
