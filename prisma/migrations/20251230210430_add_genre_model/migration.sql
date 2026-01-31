/*
  Warnings:

  - You are about to drop the column `genreId` on the `Post` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Post" DROP COLUMN "genreId";

-- CreateTable
CREATE TABLE "Genre" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Genre_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostGenre" (
    "postId" TEXT NOT NULL,
    "genreId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PostGenre_pkey" PRIMARY KEY ("postId","genreId")
);

-- CreateIndex
CREATE INDEX "PostGenre_genreId_idx" ON "PostGenre"("genreId");

-- CreateIndex
CREATE INDEX "PostGenre_postId_idx" ON "PostGenre"("postId");

-- AddForeignKey
ALTER TABLE "PostGenre" ADD CONSTRAINT "PostGenre_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostGenre" ADD CONSTRAINT "PostGenre_genreId_fkey" FOREIGN KEY ("genreId") REFERENCES "Genre"("id") ON DELETE CASCADE ON UPDATE CASCADE;
