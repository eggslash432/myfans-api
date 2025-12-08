-- CreateTable
CREATE TABLE "FeeSetting" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "managerPercent" INTEGER NOT NULL,
    "shopPercent" INTEGER NOT NULL,
    "creatorPercent" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeeSetting_pkey" PRIMARY KEY ("id")
);
