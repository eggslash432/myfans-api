/*
  Warnings:

  - You are about to drop the column `type` on the `WebhookLog` table. All the data in the column will be lost.
  - Added the required column `action` to the `WebhookLog` table without a default value. This is not possible if the table is not empty.
  - Added the required column `eventId` to the `WebhookLog` table without a default value. This is not possible if the table is not empty.
  - Added the required column `success` to the `WebhookLog` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "WebhookLog" DROP COLUMN "type",
ADD COLUMN     "action" TEXT NOT NULL,
ADD COLUMN     "eventId" TEXT NOT NULL,
ADD COLUMN     "message" TEXT,
ADD COLUMN     "success" BOOLEAN NOT NULL;

-- CreateIndex
CREATE INDEX "WebhookLog_eventId_createdAt_idx" ON "WebhookLog"("eventId", "createdAt");

-- AddForeignKey
ALTER TABLE "WebhookLog" ADD CONSTRAINT "WebhookLog_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "WebhookEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
