/*
  Warnings:

  - A unique constraint covering the columns `[id]` on the table `Creator` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Creator" ADD COLUMN     "id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Creator_id_key" ON "Creator"("id");
