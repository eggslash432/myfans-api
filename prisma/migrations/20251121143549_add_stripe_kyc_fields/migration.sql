-- AlterTable
ALTER TABLE "Creator" ADD COLUMN     "stripeChargesEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stripeKycDisabledReason" TEXT,
ADD COLUMN     "stripeKycErrors" TEXT,
ADD COLUMN     "stripeKycFieldsDue" TEXT,
ADD COLUMN     "stripePayoutsEnabled" BOOLEAN NOT NULL DEFAULT false;
