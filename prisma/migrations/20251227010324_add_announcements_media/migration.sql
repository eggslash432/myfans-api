-- DropIndex
DROP INDEX "Announcement_isEnabled_idx";

-- DropIndex
DROP INDEX "Announcement_startsAt_endsAt_idx";

-- CreateTable
CREATE TABLE "AnnouncementMedia" (
    "id" SERIAL NOT NULL,
    "announcementId" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnnouncementMedia_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "AnnouncementMedia" ADD CONSTRAINT "AnnouncementMedia_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "Announcement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
