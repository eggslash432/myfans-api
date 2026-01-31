/*
  Warnings:

  - Added the required column `category` to the `HelpArticle` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "HelpCategory" AS ENUM ('GUIDE', 'FAQ');

-- AlterTable
ALTER TABLE "HelpArticle" DROP COLUMN "category",
ADD COLUMN     "category" "HelpCategory" NOT NULL;

-- CreateTable
CREATE TABLE "SitePage" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SitePage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SitePage_slug_key" ON "SitePage"("slug");

-- CreateIndex
CREATE INDEX "HelpArticle_isPublished_category_order_idx" ON "HelpArticle"("isPublished", "category", "order");

-- CreateIndex
CREATE INDEX "HelpArticle_category_order_idx" ON "HelpArticle"("category", "order");
