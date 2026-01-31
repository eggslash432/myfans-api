-- CreateTable
CREATE TABLE "ErrorLog" (
    "id" SERIAL NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'error',
    "message" TEXT NOT NULL,
    "name" TEXT,
    "stack" TEXT,
    "statusCode" INTEGER,
    "method" TEXT,
    "path" TEXT,
    "userId" TEXT,
    "role" "Role",
    "ip" TEXT,
    "userAgent" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErrorLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ErrorLog_createdAt_idx" ON "ErrorLog"("createdAt");

-- CreateIndex
CREATE INDEX "ErrorLog_statusCode_idx" ON "ErrorLog"("statusCode");

-- CreateIndex
CREATE INDEX "ErrorLog_userId_idx" ON "ErrorLog"("userId");

-- CreateIndex
CREATE INDEX "ErrorLog_path_idx" ON "ErrorLog"("path");
