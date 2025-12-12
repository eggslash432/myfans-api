-- AlterTable
ALTER TABLE "PostMedia" ADD COLUMN     "isSample" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "PostMedia_postId_isSample_idx" ON "PostMedia"("postId", "isSample");
