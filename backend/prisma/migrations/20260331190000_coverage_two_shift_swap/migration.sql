-- AlterTable
ALTER TABLE "CoverageRequest" ADD COLUMN "secondShiftId" TEXT;

-- AddForeignKey
ALTER TABLE "CoverageRequest" ADD CONSTRAINT "CoverageRequest_secondShiftId_fkey" FOREIGN KEY ("secondShiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
