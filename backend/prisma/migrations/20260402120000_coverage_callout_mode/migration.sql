-- CreateEnum
CREATE TYPE "CalloutMode" AS ENUM ('OPEN', 'DIRECTED');

-- AlterTable
ALTER TABLE "CoverageRequest" ADD COLUMN "calloutMode" "CalloutMode";
