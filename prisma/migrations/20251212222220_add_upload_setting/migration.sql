-- CreateTable
CREATE TABLE "UploadSetting" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "maxFileSizeMb" INTEGER NOT NULL DEFAULT 200,
    "maxFiles" INTEGER NOT NULL DEFAULT 10,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UploadSetting_pkey" PRIMARY KEY ("id")
);
