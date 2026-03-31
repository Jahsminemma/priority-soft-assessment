import type { ShiftDto } from "@shiftsync/shared";
import type { ShiftRecord } from "./types.js";

export function shiftRecordToDto(record: ShiftRecord): ShiftDto {
  return {
    id: record.id,
    locationId: record.locationId,
    startAtUtc: record.startAtUtc.toISOString(),
    endAtUtc: record.endAtUtc.toISOString(),
    requiredSkillId: record.requiredSkillId,
    headcount: record.headcount,
    isPremium: record.isPremium,
    status: record.status,
    weekKey: record.weekKey,
    createdById: record.createdById,
  };
}
