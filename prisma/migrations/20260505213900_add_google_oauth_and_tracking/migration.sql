-- AlterTable: Add Google OAuth and location tracking columns to users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "googleId" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lastIpAddress" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lastCity" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lastState" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lastPincode" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lastCountry" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totalVisits" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex: unique constraint on googleId
CREATE UNIQUE INDEX IF NOT EXISTS "users_googleId_key" ON "users"("googleId");

-- AlterEnum: Add PHYSICAL_PRODUCT to ItemCategory
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'PHYSICAL_PRODUCT'
      AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'ItemCategory')
  ) THEN
    ALTER TYPE "ItemCategory" ADD VALUE 'PHYSICAL_PRODUCT';
  END IF;
END $$;
