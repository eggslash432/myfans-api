/*
  Warnings:

  - You are about to drop the column `postPublishedStatus` on the `Post` table. All the data in the column will be lost.
  - You are about to drop the column `postVisibility` on the `Post` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "Post_creatorId_postPublishedStatus_idx";

-- DropIndex
DROP INDEX "Post_postVisibility_planId_idx";

-- AlterTable
ALTER TABLE "Post" DROP COLUMN "postPublishedStatus",
DROP COLUMN "postVisibility",
ADD COLUMN     "publishedStatus" "PostPublishedStatus" NOT NULL DEFAULT 'draft',
ADD COLUMN     "visibility" "PostVisibility" NOT NULL DEFAULT 'free';

-- CreateIndex
CREATE INDEX "Post_creatorId_publishedStatus_idx" ON "Post"("creatorId", "publishedStatus");

-- CreateIndex
CREATE INDEX "Post_visibility_planId_idx" ON "Post"("visibility", "planId");
