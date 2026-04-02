-- AlterTable
ALTER TABLE "ClockInVerificationCode" ADD COLUMN     "verifiedByUserId" TEXT;

-- AddForeignKey
ALTER TABLE "ClockInVerificationCode" ADD CONSTRAINT "ClockInVerificationCode_verifiedByUserId_fkey" FOREIGN KEY ("verifiedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
