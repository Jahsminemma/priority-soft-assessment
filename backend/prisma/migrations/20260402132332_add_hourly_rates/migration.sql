-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "defaultHourlyRate" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "hourlyRate" DOUBLE PRECISION;
