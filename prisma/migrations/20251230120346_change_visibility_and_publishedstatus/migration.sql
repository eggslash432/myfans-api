/*
  Warnings:

  - You are about to drop the column `publishedStatus` on the `Post` table. All the data in the column will be lost.
  - You are about to drop the column `visibility` on the `Post` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "PostPublishedStatus" AS ENUM ('draft', 'published', 'private');

-- CreateEnum
CREATE TYPE "PostVisibility" AS ENUM ('free', 'plan', 'paid_single');

-- DropIndex
DROP INDEX "Post_creatorId_publishedStatus_idx";

-- DropIndex
DROP INDEX "Post_visibility_planId_idx";

-- AlterTable
ALTER TABLE "Post" DROP COLUMN "publishedStatus",
DROP COLUMN "visibility",
ADD COLUMN     "postPublishedStatus" "PostPublishedStatus" NOT NULL DEFAULT 'draft',
ADD COLUMN     "postVisibility" "PostVisibility" NOT NULL DEFAULT 'free';

-- DropEnum
DROP TYPE "PublishedStatus";

-- DropEnum
DROP TYPE "Visibility";

-- CreateIndex
CREATE INDEX "Post_creatorId_postPublishedStatus_idx" ON "Post"("creatorId", "postPublishedStatus");

-- CreateIndex
CREATE INDEX "Post_postVisibility_planId_idx" ON "Post"("postVisibility", "planId");
