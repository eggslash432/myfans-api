-- CreateEnum
CREATE TYPE "LegalDocumentType" AS ENUM ('terms', 'privacy', 'guideline', 'other');

-- CreateEnum
CREATE TYPE "NgWordKind" AS ENUM ('sexual', 'illegal', 'pii', 'other');

-- CreateEnum
CREATE TYPE "NgWordSeverity" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "ModerationTargetType" AS ENUM ('post_text', 'post_media');

-- CreateEnum
CREATE TYPE "ModerationDecision" AS ENUM ('allow', 'review', 'reject');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('none', 'pending_review', 'approved', 'held', 'rejected');

-- CreateEnum
CREATE TYPE "BusinessLicenseStatus" AS ENUM ('pending', 'approved', 'rejected');

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'none';

-- AlterTable
ALTER TABLE "Shop" ADD COLUMN     "businessLicenseCheckedAt" TIMESTAMP(3),
ADD COLUMN     "businessLicenseCheckedBy" TEXT,
ADD COLUMN     "businessLicenseFileKey" TEXT,
ADD COLUMN     "businessLicenseStatus" "BusinessLicenseStatus" NOT NULL DEFAULT 'pending';

-- CreateTable
CREATE TABLE "HelpArticle" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HelpArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalDocument" (
    "id" TEXT NOT NULL,
    "type" "LegalDocumentType" NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAgreement" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "type" "LegalDocumentType" NOT NULL,
    "version" INTEGER NOT NULL,
    "agreedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "UserAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NgWord" (
    "id" TEXT NOT NULL,
    "word" TEXT NOT NULL,
    "kind" "NgWordKind" NOT NULL,
    "severity" "NgWordSeverity" NOT NULL DEFAULT 'medium',
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NgWord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationResult" (
    "id" TEXT NOT NULL,
    "targetType" "ModerationTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "postId" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'OPENAI',
    "decision" "ModerationDecision" NOT NULL,
    "reasons" TEXT,
    "raw" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModerationResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationSetting" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "inAppEnabled" BOOLEAN NOT NULL DEFAULT true,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HelpArticle_slug_key" ON "HelpArticle"("slug");

-- CreateIndex
CREATE INDEX "HelpArticle_isPublished_category_order_idx" ON "HelpArticle"("isPublished", "category", "order");

-- CreateIndex
CREATE INDEX "HelpArticle_category_order_idx" ON "HelpArticle"("category", "order");

-- CreateIndex
CREATE INDEX "LegalDocument_type_publishedAt_idx" ON "LegalDocument"("type", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LegalDocument_type_version_key" ON "LegalDocument"("type", "version");

-- CreateIndex
CREATE INDEX "UserAgreement_userId_agreedAt_idx" ON "UserAgreement"("userId", "agreedAt");

-- CreateIndex
CREATE INDEX "UserAgreement_type_version_idx" ON "UserAgreement"("type", "version");

-- CreateIndex
CREATE INDEX "UserAgreement_documentId_idx" ON "UserAgreement"("documentId");

-- CreateIndex
CREATE INDEX "NgWord_isEnabled_kind_severity_idx" ON "NgWord"("isEnabled", "kind", "severity");

-- CreateIndex
CREATE UNIQUE INDEX "NgWord_word_kind_key" ON "NgWord"("word", "kind");

-- CreateIndex
CREATE INDEX "ModerationResult_targetType_targetId_createdAt_idx" ON "ModerationResult"("targetType", "targetId", "createdAt");

-- CreateIndex
CREATE INDEX "ModerationResult_postId_createdAt_idx" ON "ModerationResult"("postId", "createdAt");

-- CreateIndex
CREATE INDEX "ModerationResult_decision_createdAt_idx" ON "ModerationResult"("decision", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationSetting_userId_idx" ON "NotificationSetting"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationSetting_userId_type_key" ON "NotificationSetting"("userId", "type");

-- AddForeignKey
ALTER TABLE "UserAgreement" ADD CONSTRAINT "UserAgreement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAgreement" ADD CONSTRAINT "UserAgreement_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "LegalDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationResult" ADD CONSTRAINT "ModerationResult_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationSetting" ADD CONSTRAINT "NotificationSetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
