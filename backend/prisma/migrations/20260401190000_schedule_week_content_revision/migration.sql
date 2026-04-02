-- AlterTable
ALTER TABLE "ScheduleWeek" ADD COLUMN "scheduleContentRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ScheduleWeek" ADD COLUMN "publishedContentRevision" INTEGER NOT NULL DEFAULT 0;
