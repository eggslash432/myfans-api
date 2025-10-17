-- CreateEnum
CREATE TYPE "public"."AgeRating" AS ENUM ('all', 'r18');

-- AlterTable
ALTER TABLE "public"."Post" ADD COLUMN     "ageRating" "public"."AgeRating" NOT NULL DEFAULT 'all';

-- CreateTable
CREATE TABLE "public"."PostAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "PostAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PostAccess_userId_postId_key" ON "public"."PostAccess"("userId", "postId");
