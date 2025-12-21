-- CreateTable
CREATE TABLE "ShopInvite" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "role" "ShopMemberRole" NOT NULL DEFAULT 'staff',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "ShopInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopInvite_code_key" ON "ShopInvite"("code");

-- AddForeignKey
ALTER TABLE "ShopInvite" ADD CONSTRAINT "ShopInvite_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
