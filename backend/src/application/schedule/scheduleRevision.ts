import { normalizeIsoWeekKey } from "@shiftsync/shared";
import { weekStartDateLocalFromWeekKey } from "../../domain/scheduling/index.js";
import { prisma } from "../../infrastructure/persistence/index.js";

/** Increments draft fingerprint when shifts or assignments change while a schedule week row exists. */
export async function bumpScheduleContentRevision(locationId: string, weekKey: string): Promise<void> {
  const weekKeyNorm = normalizeIsoWeekKey(weekKey);
  const location = await prisma.location.findUnique({ where: { id: locationId } });
  if (!location) return;
  const weekStartDateLocal = weekStartDateLocalFromWeekKey(weekKeyNorm, location.tzIana);
  await prisma.scheduleWeek.updateMany({
    where: { locationId, weekStartDateLocal },
    data: { scheduleContentRevision: { increment: 1 } },
  });
}

/** One increment per distinct (location, ISO week); avoids double-counting a two-site swap in the same week. */
export async function bumpScheduleContentRevisionsForShifts(
  pairs: Array<{ locationId: string; weekKey: string }>,
): Promise<void> {
  const seen = new Set<string>();
  for (const p of pairs) {
    const wk = normalizeIsoWeekKey(p.weekKey);
    const k = `${p.locationId}::${wk}`;
    if (seen.has(k)) continue;
    seen.add(k);
    await bumpScheduleContentRevision(p.locationId, wk);
  }
}
