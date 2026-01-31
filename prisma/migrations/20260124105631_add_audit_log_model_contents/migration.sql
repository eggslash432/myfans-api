-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "actorRole" TEXT,
ADD COLUMN     "targetId" TEXT,
ADD COLUMN     "targetType" TEXT,
ADD COLUMN     "userAgent" TEXT;
