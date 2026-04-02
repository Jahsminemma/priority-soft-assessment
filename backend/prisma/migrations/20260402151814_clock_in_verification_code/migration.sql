-- CreateTable
CREATE TABLE "ClockInVerificationCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "staffUserId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "ClockInVerificationCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClockInVerificationCode_code_key" ON "ClockInVerificationCode"("code");

-- CreateIndex
CREATE INDEX "ClockInVerificationCode_staffUserId_shiftId_idx" ON "ClockInVerificationCode"("staffUserId", "shiftId");

-- AddForeignKey
ALTER TABLE "ClockInVerificationCode" ADD CONSTRAINT "ClockInVerificationCode_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClockInVerificationCode" ADD CONSTRAINT "ClockInVerificationCode_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
