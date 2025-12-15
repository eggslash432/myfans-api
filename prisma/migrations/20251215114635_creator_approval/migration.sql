-- CreateEnum
CREATE TYPE "CreatorApprovalStatus" AS ENUM ('pending', 'approved', 'rejected');

-- AlterTable
ALTER TABLE "Creator" ADD COLUMN     "approvalStatus" "CreatorApprovalStatus" NOT NULL DEFAULT 'pending',
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "rejectReason" TEXT,
ADD COLUMN     "rejectedAt" TIMESTAMP(3);
