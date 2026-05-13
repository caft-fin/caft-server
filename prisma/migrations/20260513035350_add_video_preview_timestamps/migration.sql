-- AlterTable
ALTER TABLE "videos" ADD COLUMN     "previewEndSeconds" INTEGER,
ADD COLUMN     "previewStartSeconds" INTEGER NOT NULL DEFAULT 0;
