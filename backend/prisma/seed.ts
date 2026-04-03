import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { DateTime } from "luxon";

dotenv.config();

const prisma = new PrismaClient();

/**
 * Stable shift UUIDs (see frontend/src/constants.ts SEED).
 * Next ISO week (Monday-start) after seed run — pick that week in the UI to see seeded shifts.
 */
const SHIFT_IDS = {
  sfServerDraft: "d0000000-0000-4000-8000-000000000001",
  sfServerPartial: "d0000000-0000-4000-8000-000000000002",
  sfBartenderFull: "d0000000-0000-4000-8000-000000000003",
  laBartenderDraft: "d0000000-0000-4000-8000-000000000004",
  nyHost: "d0000000-0000-4000-8000-000000000005",
  nyServer: "d0000000-0000-4000-8000-000000000006",
  sfWedDrop: "d0000000-0000-4000-8000-000000000007",
  sfJamieOverlapA: "d0000000-0000-4000-8000-000000000008",
  sfJamieOverlapB: "d0000000-0000-4000-8000-000000000009",
  sfJamieRestMon: "d0000000-0000-4000-8000-00000000000a",
  sfJamieRestTue: "d0000000-0000-4000-8000-00000000000b",
  sfSatLongJamie: "d0000000-0000-4000-8000-00000000000c",
  laLineCookThu: "d0000000-0000-4000-8000-00000000000d",
  /** LA only — Casey stacked for projected OT + WEEKLY_WARN at this site (Analytics). */
  laCaseyOtMon: "d0000000-0000-4000-8000-00000000000e",
  laCaseyOtTue: "d0000000-0000-4000-8000-00000000000f",
  laCaseyOtWed: "d0000000-0000-4000-8000-000000000010",
  laCaseyOtThu: "d0000000-0000-4000-8000-000000000011",
  laCaseyOtFri: "d0000000-0000-4000-8000-000000000012",
  laCaseyOtSat: "d0000000-0000-4000-8000-000000000013",
  /** Boston — Taylor Mon split: assign 2nd slot to preview DAILY_WARN_8H. */
  bosTaylorMonA: "d0000000-0000-4000-8000-000000000014",
  bosTaylorMonB: "d0000000-0000-4000-8000-000000000015",
  /** Boston — open bartender; Pat/Riley preview → NOT_CERTIFIED. */
  bosBartOpen: "d0000000-0000-4000-8000-000000000016",
  /** NYC — Quinn Mon split: assign 2nd to preview DAILY_WARN_8H. */
  nyQuinnMonA: "d0000000-0000-4000-8000-000000000017",
  nyQuinnMonB: "d0000000-0000-4000-8000-000000000018",
  /** SF — crosses local midnight (segmented day rules). */
  sfOvernightFri: "d0000000-0000-4000-8000-000000000019",
} as const;

const ALL_SHIFT_IDS: string[] = Object.values(SHIFT_IDS);

async function main(): Promise<void> {
  const passwordHash = await bcrypt.hash("password123", 10);

  const locSf = await prisma.location.upsert({
    where: { id: "a0000000-0000-4000-8000-000000000001" },
    update: { defaultHourlyRate: 22 },
    create: {
      id: "a0000000-0000-4000-8000-000000000001",
      name: "Coastal Eats — SF",
      tzIana: "America/Los_Angeles",
      defaultHourlyRate: 22,
    },
  });

  const locLa = await prisma.location.upsert({
    where: { id: "a0000000-0000-4000-8000-000000000002" },
    update: { defaultHourlyRate: 20 },
    create: {
      id: "a0000000-0000-4000-8000-000000000002",
      name: "Coastal Eats — LA",
      tzIana: "America/Los_Angeles",
      defaultHourlyRate: 20,
    },
  });

  const locNy = await prisma.location.upsert({
    where: { id: "a0000000-0000-4000-8000-000000000003" },
    update: { defaultHourlyRate: 25 },
    create: {
      id: "a0000000-0000-4000-8000-000000000003",
      name: "Coastal Eats — NYC",
      tzIana: "America/New_York",
      defaultHourlyRate: 25,
    },
  });

  /** Fourth site — same Eastern zone as NYC (brief: four locations, two US time zones). */
  const locBoston = await prisma.location.upsert({
    where: { id: "a0000000-0000-4000-8000-000000000004" },
    update: { defaultHourlyRate: 24 },
    create: {
      id: "a0000000-0000-4000-8000-000000000004",
      name: "Coastal Eats — Boston",
      tzIana: "America/New_York",
      defaultHourlyRate: 24,
    },
  });

  const skillServer = await prisma.skill.upsert({
    where: { id: "b0000000-0000-4000-8000-000000000001" },
    update: {},
    create: { id: "b0000000-0000-4000-8000-000000000001", name: "server" },
  });
  const skillBar = await prisma.skill.upsert({
    where: { id: "b0000000-0000-4000-8000-000000000002" },
    update: {},
    create: { id: "b0000000-0000-4000-8000-000000000002", name: "bartender" },
  });
  const skillLineCook = await prisma.skill.upsert({
    where: { id: "b0000000-0000-4000-8000-000000000003" },
    update: {},
    create: { id: "b0000000-0000-4000-8000-000000000003", name: "line_cook" },
  });
  const skillHost = await prisma.skill.upsert({
    where: { id: "b0000000-0000-4000-8000-000000000004" },
    update: {},
    create: { id: "b0000000-0000-4000-8000-000000000004", name: "host" },
  });

  await prisma.user.upsert({
    where: { email: "admin@coastaleats.test" },
    update: {},
    create: {
      id: "c0000000-0000-4000-8000-000000000001",
      email: "admin@coastaleats.test",
      passwordHash,
      name: "Alex Admin",
      role: "ADMIN",
      desiredHoursWeekly: null,
    },
  });

  const manager = await prisma.user.upsert({
    where: { email: "manager@coastaleats.test" },
    update: {},
    create: {
      id: "c0000000-0000-4000-8000-000000000002",
      email: "manager@coastaleats.test",
      passwordHash,
      name: "Morgan Manager",
      role: "MANAGER",
      desiredHoursWeekly: null,
    },
  });

  await prisma.managerLocation.deleteMany({ where: { userId: manager.id } });
  await prisma.managerLocation.createMany({
    data: [
      { userId: manager.id, locationId: locSf.id },
      { userId: manager.id, locationId: locLa.id },
      { userId: manager.id, locationId: locNy.id },
      { userId: manager.id, locationId: locBoston.id },
    ],
  });

  const staffSam = await prisma.user.upsert({
    where: { email: "sam@coastaleats.test" },
    update: { name: "Sam Rivera", hourlyRate: 24 },
    create: {
      id: "c0000000-0000-4000-8000-000000000010",
      email: "sam@coastaleats.test",
      passwordHash,
      name: "Sam Rivera",
      role: "STAFF",
      desiredHoursWeekly: 32,
      hourlyRate: 24,
    },
  });

  const staffJordan = await prisma.user.upsert({
    where: { email: "jordan@coastaleats.test" },
    update: { name: "Jordan Lee", hourlyRate: 26 },
    create: {
      id: "c0000000-0000-4000-8000-000000000011",
      email: "jordan@coastaleats.test",
      passwordHash,
      name: "Jordan Lee",
      role: "STAFF",
      desiredHoursWeekly: 28,
      hourlyRate: 26,
    },
  });

  const staffCasey = await prisma.user.upsert({
    where: { email: "casey@coastaleats.test" },
    update: { name: "Casey Patel" },
    create: {
      id: "c0000000-0000-4000-8000-000000000012",
      email: "casey@coastaleats.test",
      passwordHash,
      name: "Casey Patel",
      role: "STAFF",
      desiredHoursWeekly: 30,
    },
  });

  const staffRiley = await prisma.user.upsert({
    where: { email: "riley@coastaleats.test" },
    update: { name: "Riley Chen" },
    create: {
      id: "c0000000-0000-4000-8000-000000000013",
      email: "riley@coastaleats.test",
      passwordHash,
      name: "Riley Chen",
      role: "STAFF",
      desiredHoursWeekly: 25,
    },
  });

  const staffJamie = await prisma.user.upsert({
    where: { email: "jamie@coastaleats.test" },
    update: { name: "Jamie Nguyen" },
    create: {
      id: "c0000000-0000-4000-8000-000000000014",
      email: "jamie@coastaleats.test",
      passwordHash,
      name: "Jamie Nguyen",
      role: "STAFF",
      desiredHoursWeekly: 30,
    },
  });
  const staffPat = await prisma.user.upsert({
    where: { email: "pat@coastaleats.test" },
    update: { name: "Pat Johnson" },
    create: {
      id: "c0000000-0000-4000-8000-000000000015",
      email: "pat@coastaleats.test",
      passwordHash,
      name: "Pat Johnson",
      role: "STAFF",
      desiredHoursWeekly: 28,
    },
  });
  const staffQuinn = await prisma.user.upsert({
    where: { email: "quinn@coastaleats.test" },
    update: { name: "Quinn Davis" },
    create: {
      id: "c0000000-0000-4000-8000-000000000016",
      email: "quinn@coastaleats.test",
      passwordHash,
      name: "Quinn Davis",
      role: "STAFF",
      desiredHoursWeekly: 24,
    },
  });
  const staffTaylor = await prisma.user.upsert({
    where: { email: "taylor@coastaleats.test" },
    update: { name: "Taylor Brooks" },
    create: {
      id: "c0000000-0000-4000-8000-000000000017",
      email: "taylor@coastaleats.test",
      passwordHash,
      name: "Taylor Brooks",
      role: "STAFF",
      desiredHoursWeekly: 32,
    },
  });
  const staffDrew = await prisma.user.upsert({
    where: { email: "drew@coastaleats.test" },
    update: { name: "Drew Martinez" },
    create: {
      id: "c0000000-0000-4000-8000-000000000018",
      email: "drew@coastaleats.test",
      passwordHash,
      name: "Drew Martinez",
      role: "STAFF",
      desiredHoursWeekly: 36,
    },
  });

  /** Weekend-only availability — tests weekday assignment blocks. */
  const staffEve = await prisma.user.upsert({
    where: { email: "eve@coastaleats.test" },
    update: { name: "Eve Weekend" },
    create: {
      id: "c0000000-0000-4000-8000-000000000019",
      email: "eve@coastaleats.test",
      passwordHash,
      name: "Eve Weekend",
      role: "STAFF",
      desiredHoursWeekly: 20,
    },
  });

  const staffIds = [
    staffSam.id,
    staffJordan.id,
    staffCasey.id,
    staffRiley.id,
    staffJamie.id,
    staffPat.id,
    staffQuinn.id,
    staffTaylor.id,
    staffDrew.id,
    staffEve.id,
  ];

  await prisma.staffSkill.deleteMany({
    where: { userId: { in: staffIds } },
  });
  await prisma.staffSkill.createMany({
    data: [
      { userId: staffSam.id, skillId: skillServer.id },
      { userId: staffJordan.id, skillId: skillBar.id },
      { userId: staffJordan.id, skillId: skillServer.id },
      { userId: staffCasey.id, skillId: skillServer.id },
      { userId: staffRiley.id, skillId: skillBar.id },
      { userId: staffJamie.id, skillId: skillServer.id },
      { userId: staffPat.id, skillId: skillBar.id },
      { userId: staffQuinn.id, skillId: skillHost.id },
      { userId: staffTaylor.id, skillId: skillServer.id },
      { userId: staffTaylor.id, skillId: skillBar.id },
      { userId: staffDrew.id, skillId: skillLineCook.id },
      { userId: staffEve.id, skillId: skillServer.id },
    ],
  });

  await prisma.staffCertification.deleteMany({
    where: { userId: { in: staffIds } },
  });
  await prisma.staffCertification.createMany({
    data: [
      { userId: staffSam.id, locationId: locSf.id },
      { userId: staffSam.id, locationId: locNy.id },
      { userId: staffSam.id, locationId: locBoston.id },
      { userId: staffJordan.id, locationId: locSf.id },
      { userId: staffJordan.id, locationId: locNy.id },
      { userId: staffJordan.id, locationId: locBoston.id },
      { userId: staffCasey.id, locationId: locLa.id },
      { userId: staffRiley.id, locationId: locLa.id },
      { userId: staffJamie.id, locationId: locSf.id },
      { userId: staffJamie.id, locationId: locLa.id },
      { userId: staffJamie.id, locationId: locNy.id },
      { userId: staffJamie.id, locationId: locBoston.id },
      { userId: staffPat.id, locationId: locSf.id },
      { userId: staffPat.id, locationId: locLa.id },
      { userId: staffPat.id, locationId: locNy.id },
      { userId: staffQuinn.id, locationId: locSf.id },
      { userId: staffQuinn.id, locationId: locLa.id },
      { userId: staffQuinn.id, locationId: locNy.id },
      { userId: staffTaylor.id, locationId: locSf.id },
      { userId: staffTaylor.id, locationId: locLa.id },
      { userId: staffTaylor.id, locationId: locNy.id },
      { userId: staffTaylor.id, locationId: locBoston.id },
      { userId: staffDrew.id, locationId: locSf.id },
      { userId: staffDrew.id, locationId: locLa.id },
      { userId: staffEve.id, locationId: locSf.id },
    ],
  });

  const days = [0, 1, 2, 3, 4, 5, 6] as const;
  await prisma.availabilityRule.deleteMany({
    where: { userId: { in: staffIds } },
  });
  await prisma.availabilityRule.createMany({
    data: staffIds
      .filter((id) => id !== staffEve.id)
      .flatMap((userId) =>
        days.map((dayOfWeek) => ({
          userId,
          dayOfWeek,
          startLocalTime: "00:00",
          endLocalTime: "23:59",
        })),
      ),
  });
  /** Eve: Sat + Sun only (DB dayOfWeek: 0=Sun … 6=Sat). */
  await prisma.availabilityRule.createMany({
    data: [0, 6].map((dayOfWeek) => ({
      userId: staffEve.id,
      dayOfWeek,
      startLocalTime: "00:00",
      endLocalTime: "23:59",
    })),
  });

  const zoneSf = locSf.tzIana;
  const nowInSf = DateTime.now().setZone(zoneSf);
  const thisWeekMonday = DateTime.fromObject(
    { weekYear: nowInSf.weekYear, weekNumber: nowInSf.weekNumber },
    { zone: zoneSf },
  ).startOf("week");
  /** Monday of next ISO week (reviewers see data in the upcoming week). */
  const monSf = thisWeekMonday.plus({ weeks: 1 });
  const weekYear = monSf.weekYear;
  const weekNumber = monSf.weekNumber;
  const weekKey = `${weekYear}-W${String(weekNumber).padStart(2, "0")}`;

  const wallUtc = (wall: DateTime): Date => wall.toUTC().toJSDate();

  const shiftSfDraftStart = monSf.set({ hour: 17, minute: 0, second: 0, millisecond: 0 });
  const shiftSfDraftEnd = monSf.set({ hour: 22, minute: 0, second: 0, millisecond: 0 });

  const tueSf = monSf.plus({ days: 1 });
  const shiftSfPartialStart = tueSf.set({ hour: 11, minute: 0, second: 0, millisecond: 0 });
  const shiftSfPartialEnd = tueSf.set({ hour: 15, minute: 0, second: 0, millisecond: 0 });

  const friSf = monSf.plus({ days: 4 });
  const shiftSfBarStart = friSf.set({ hour: 18, minute: 0, second: 0, millisecond: 0 });
  const shiftSfBarEnd = friSf.set({ hour: 23, minute: 0, second: 0, millisecond: 0 });

  const wedSf = monSf.plus({ days: 2 });
  const wedLa = monSf.plus({ days: 2 });
  const shiftLaBarStart = wedLa.set({ hour: 16, minute: 0, second: 0, millisecond: 0 });
  const shiftLaBarEnd = wedLa.set({ hour: 21, minute: 0, second: 0, millisecond: 0 });

  const shiftSfWedDropStart = wedSf.set({ hour: 12, minute: 0, second: 0, millisecond: 0 });
  const shiftSfWedDropEnd = wedSf.set({ hour: 16, minute: 0, second: 0, millisecond: 0 });

  const thuSf = monSf.plus({ days: 3 });
  const shiftJamieOverlapAStart = thuSf.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
  const shiftJamieOverlapAEnd = thuSf.set({ hour: 14, minute: 0, second: 0, millisecond: 0 });
  const shiftJamieOverlapBStart = thuSf.set({ hour: 12, minute: 0, second: 0, millisecond: 0 });
  const shiftJamieOverlapBEnd = thuSf.set({ hour: 18, minute: 0, second: 0, millisecond: 0 });

  const shiftJamieRestMonStart = monSf.set({ hour: 16, minute: 0, second: 0, millisecond: 0 });
  const shiftJamieRestMonEnd = monSf.set({ hour: 21, minute: 0, second: 0, millisecond: 0 });
  const shiftJamieRestTueStart = tueSf.set({ hour: 5, minute: 0, second: 0, millisecond: 0 });
  const shiftJamieRestTueEnd = tueSf.set({ hour: 9, minute: 0, second: 0, millisecond: 0 });

  const satSf = monSf.plus({ days: 5 });
  const shiftSatLongStart = satSf.set({ hour: 8, minute: 0, second: 0, millisecond: 0 });
  const shiftSatLongEnd = satSf.set({ hour: 21, minute: 0, second: 0, millisecond: 0 });

  const thuLa = monSf.plus({ days: 3 });
  const shiftLaLineStart = thuLa.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
  const shiftLaLineEnd = thuLa.set({ hour: 18, minute: 0, second: 0, millisecond: 0 });

  const monNy = DateTime.fromObject({ weekYear, weekNumber }, { zone: locNy.tzIana }).startOf("week");
  const thuNy = monNy.plus({ days: 3 });
  const shiftNyHostStart = thuNy.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
  const shiftNyHostEnd = thuNy.set({ hour: 14, minute: 0, second: 0, millisecond: 0 });
  const shiftNyServerStart = thuNy.set({ hour: 14, minute: 0, second: 0, millisecond: 0 });
  const shiftNyServerEnd = thuNy.set({ hour: 20, minute: 0, second: 0, millisecond: 0 });

  const monLa = DateTime.fromObject({ weekYear, weekNumber }, { zone: locLa.tzIana }).startOf("week");
  const satLa = monLa.plus({ days: 5 });
  const laCaseyDay = (d: number) => monLa.plus({ days: d }).set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
  const laCaseyDayEnd = (d: number) => monLa.plus({ days: d }).set({ hour: 18, minute: 0, second: 0, millisecond: 0 });
  const laCaseySatStart = satLa.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
  const laCaseySatEnd = satLa.set({ hour: 17, minute: 0, second: 0, millisecond: 0 });

  const monBoston = DateTime.fromObject({ weekYear, weekNumber }, { zone: locBoston.tzIana }).startOf("week");
  const bosSat = monBoston.plus({ days: 5 });
  const bosTaylorMonAStart = monBoston.set({ hour: 11, minute: 0, second: 0, millisecond: 0 });
  const bosTaylorMonAEnd = monBoston.set({ hour: 15, minute: 0, second: 0, millisecond: 0 });
  const bosTaylorMonBStart = monBoston.set({ hour: 16, minute: 0, second: 0, millisecond: 0 });
  const bosTaylorMonBEnd = monBoston.set({ hour: 21, minute: 0, second: 0, millisecond: 0 });
  const bosBartStart = bosSat.set({ hour: 18, minute: 0, second: 0, millisecond: 0 });
  const bosBartEnd = bosSat.set({ hour: 23, minute: 0, second: 0, millisecond: 0 });

  const nyQuinnMonAStart = monNy.set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
  const nyQuinnMonAEnd = monNy.set({ hour: 14, minute: 0, second: 0, millisecond: 0 });
  const nyQuinnMonBStart = monNy.set({ hour: 15, minute: 0, second: 0, millisecond: 0 });
  const nyQuinnMonBEnd = monNy.set({ hour: 20, minute: 0, second: 0, millisecond: 0 });

  const shiftSfOvernightStart = friSf.set({ hour: 22, minute: 0, second: 0, millisecond: 0 });
  const shiftSfOvernightEnd = satSf.set({ hour: 2, minute: 0, second: 0, millisecond: 0 });

  const weekStartSf = monSf.toFormat("yyyy-LL-dd");
  const weekStartLa = DateTime.fromObject({ weekYear, weekNumber }, { zone: locLa.tzIana })
    .startOf("week")
    .toFormat("yyyy-LL-dd");
  const weekStartNy = monNy.toFormat("yyyy-LL-dd");

  await prisma.availabilityException.deleteMany({ where: { userId: staffSam.id } });
  const samWedBlockStart = wedSf.startOf("day");
  const samWedBlockEnd = wedSf.endOf("day");
  await prisma.availabilityException.create({
    data: {
      userId: staffSam.id,
      startAtUtc: wallUtc(samWedBlockStart),
      endAtUtc: wallUtc(samWedBlockEnd),
      type: "UNAVAILABLE",
      tzIana: zoneSf,
    },
  });

  await prisma.notification.deleteMany({ where: { type: "SEED_NOTIFICATION" } });

  await prisma.clockInVerificationCode.deleteMany({
    where: { shiftId: { in: ALL_SHIFT_IDS } },
  });
  await prisma.clockSession.deleteMany({
    where: { shiftId: { in: ALL_SHIFT_IDS } },
  });
  await prisma.coverageRequest.deleteMany({
    where: {
      OR: [{ shiftId: { in: ALL_SHIFT_IDS } }, { secondShiftId: { in: ALL_SHIFT_IDS } }],
    },
  });

  await prisma.shiftAssignment.deleteMany({
    where: { shiftId: { in: ALL_SHIFT_IDS } },
  });
  await prisma.shift.deleteMany({
    where: { id: { in: ALL_SHIFT_IDS } },
  });

  await prisma.scheduleWeek.upsert({
    where: {
      locationId_weekStartDateLocal: { locationId: locSf.id, weekStartDateLocal: weekStartSf },
    },
    update: { status: "PUBLISHED", cutoffHours: 48 },
    create: {
      locationId: locSf.id,
      weekStartDateLocal: weekStartSf,
      status: "PUBLISHED",
      cutoffHours: 48,
    },
  });
  await prisma.scheduleWeek.upsert({
    where: {
      locationId_weekStartDateLocal: { locationId: locLa.id, weekStartDateLocal: weekStartLa },
    },
    update: { status: "PUBLISHED", cutoffHours: 48 },
    create: {
      locationId: locLa.id,
      weekStartDateLocal: weekStartLa,
      status: "PUBLISHED",
      cutoffHours: 48,
    },
  });
  await prisma.scheduleWeek.upsert({
    where: {
      locationId_weekStartDateLocal: { locationId: locNy.id, weekStartDateLocal: weekStartNy },
    },
    update: { status: "PUBLISHED", cutoffHours: 48 },
    create: {
      locationId: locNy.id,
      weekStartDateLocal: weekStartNy,
      status: "PUBLISHED",
      cutoffHours: 48,
    },
  });
  await prisma.scheduleWeek.upsert({
    where: {
      locationId_weekStartDateLocal: { locationId: locBoston.id, weekStartDateLocal: weekStartNy },
    },
    update: { status: "PUBLISHED", cutoffHours: 48 },
    create: {
      locationId: locBoston.id,
      weekStartDateLocal: weekStartNy,
      status: "PUBLISHED",
      cutoffHours: 48,
    },
  });

  await prisma.shift.createMany({
    data: [
      {
        id: SHIFT_IDS.sfServerDraft,
        locationId: locSf.id,
        startAtUtc: wallUtc(shiftSfDraftStart),
        endAtUtc: wallUtc(shiftSfDraftEnd),
        requiredSkillId: skillServer.id,
        headcount: 2,
        isPremium: false,
        status: "DRAFT",
        weekKey,
        createdById: manager.id,
      },
      {
        id: SHIFT_IDS.sfServerPartial,
        locationId: locSf.id,
        startAtUtc: wallUtc(shiftSfPartialStart),
        endAtUtc: wallUtc(shiftSfPartialEnd),
        requiredSkillId: skillServer.id,
        headcount: 2,
        isPremium: false,
        status: "PUBLISHED",
        weekKey,
        createdById: manager.id,
      },
      {
        id: SHIFT_IDS.sfBartenderFull,
        locationId: locSf.id,
        startAtUtc: wallUtc(shiftSfBarStart),
        endAtUtc: wallUtc(shiftSfBarEnd),
        requiredSkillId: skillBar.id,
        headcount: 1,
        isPremium: true,
        status: "PUBLISHED",
        weekKey,
        createdById: manager.id,
      },
      {
        id: SHIFT_IDS.laBartenderDraft,
        locationId: locLa.id,
        startAtUtc: wallUtc(shiftLaBarStart),
        endAtUtc: wallUtc(shiftLaBarEnd),
        requiredSkillId: skillBar.id,
        headcount: 1,
        isPremium: false,
        status: "DRAFT",
        weekKey,
        createdById: manager.id,
      },
      {
        id: SHIFT_IDS.nyHost,
        locationId: locNy.id,
        startAtUtc: wallUtc(shiftNyHostStart),
        endAtUtc: wallUtc(shiftNyHostEnd),
        requiredSkillId: skillHost.id,
        headcount: 1,
        isPremium: false,
        status: "PUBLISHED",
        weekKey,
        createdById: manager.id,
      },
      {
        id: SHIFT_IDS.nyServer,
        locationId: locNy.id,
        startAtUtc: wallUtc(shiftNyServerStart),
        endAtUtc: wallUtc(shiftNyServerEnd),
        requiredSkillId: skillServer.id,
        headcount: 1,
        isPremium: false,
        status: "PUBLISHED",
        weekKey,
        createdById: manager.id,
      },
      {
        id: SHIFT_IDS.sfWedDrop,
        locationId: locSf.id,
        startAtUtc: wallUtc(shiftSfWedDropStart),
        endAtUtc: wallUtc(shiftSfWedDropEnd),
        requiredSkillId: skillServer.id,
        headcount: 1,
        isPremium: false,
        status: "PUBLISHED",
        weekKey,
        createdById: manager.id,
      },
      {
        id: SHIFT_IDS.sfJamieOverlapA,
        locationId: locSf.id,
        startAtUtc: wallUtc(shiftJamieOverlapAStart),
        endAtUtc: wallUtc(shiftJamieOverlapAEnd),
        requiredSkillId: skillServer.id,
        headcount: 1,
        isPremium: false,
        status: "PUBLISHED",
        weekKey,
        createdById: manager.id,
      },
      {
        id: SHIFT_IDS.sfJamieOverlapB,
        locationId: locSf.id,
        startAtUtc: wallUtc(shiftJamieOverlapBStart),
        endAtUtc: wallUtc(shiftJamieOverlapBEnd),
        requiredSkillId: skillServer.id,
        headcount: 1,
        isPremium: false,
        status: "PUBLISHED",
        weekKey,
        createdById: manager.id,
      },
      {
        id: SHIFT_IDS.sfJamieRestMon,
        locationId: locSf.id,
        startAtUtc: wallUtc(shiftJamieRestMonStart),
        endAtUtc: wallUtc(shiftJamieRestMonEnd),
        requiredSkillId: skillServer.id,
        headcount: 1,
        isPremium: false,
        status: "PUBLISHED",
        weekKey,
        createdById: manager.id,
      },
      {
        id: SHIFT_IDS.sfJamieRestTue,
        locationId: locSf.id,
        startAtUtc: wallUtc(shiftJamieRestTueStart),
        endAtUtc: wallUtc(shiftJamieRestTueEnd),
        requiredSkillId: skillServer.id,
        headcount: 1,
        isPremium: false,
        status: "PUBLISHED",
        weekKey,
        createdById: manager.id,
      },
      {
        id: SHIFT_IDS.sfSatLongJamie,
        locationId: locSf.id,
        startAtUtc: wallUtc(shiftSatLongStart),
        endAtUtc: wallUtc(shiftSatLongEnd),
        requiredSkillId: skillServer.id,
        headcount: 1,
        isPremium: false,
        status: "PUBLISHED",
        weekKey,
        createdById: manager.id,
      },
      {
        id: SHIFT_IDS.laLineCookThu,
        locationId: locLa.id,
        startAtUtc: wallUtc(shiftLaLineStart),
        endAtUtc: wallUtc(shiftLaLineEnd),
        requiredSkillId: skillLineCook.id,
        headcount: 2,
        isPremium: false,
        status: "PUBLISHED",
        weekKey,
        createdById: manager.id,
      },
      {
        id: SHIFT_IDS.laCaseyOtMon,
        locationId: locLa.id,
        startAtUtc: wallUtc(laCaseyDay(0)),
        endAtUtc: wallUtc(laCaseyDayEnd(0)),
        requiredSkillId: skillServer.id,
        headcount: 1,
        isPremium: false,
        status: "PUBLISHED",
        weekKey,
        createdById: manager.id,
      },
      {
        id: SHIFT_IDS.laCaseyOtTue,
        locationId: locLa.id,
        startAtUtc: wallUtc(laCaseyDay(1)),
        endAtUtc: wallUtc(laCaseyDayEnd(1)),
        requiredSkillId: skillServer.id,
        headcount: 1,
        isPremium: false,
        status: "PUBLISHED",
        weekKey,
        createdById: manager.id,
      },
      {
        id: SHIFT_IDS.laCaseyOtWed,
        locationId: locLa.id,
        startAtUtc: wallUtc(laCaseyDay(2)),
        endAtUtc: wallUtc(laCaseyDayEnd(2)),
        requiredSkillId: skillServer.id,
        headcount: 1,
        isPremium: false,
        status: "PUBLISHED",
        weekKey,
        createdById: manager.id,
      },
      {
        id: SHIFT_IDS.laCaseyOtThu,
        locationId: locLa.id,
        startAtUtc: wallUtc(laCaseyDay(3)),
        endAtUtc: wallUtc(laCaseyDayEnd(3)),
        requiredSkillId: skillServer.id,
        headcount: 1,
        isPremium: false,
        status: "PUBLISHED",
        weekKey,
        createdById: manager.id,
      },
      {
        id: SHIFT_IDS.laCaseyOtFri,
        locationId: locLa.id,
        startAtUtc: wallUtc(laCaseyDay(4)),
        endAtUtc: wallUtc(laCaseyDayEnd(4)),
        requiredSkillId: skillServer.id,
        headcount: 1,
        isPremium: false,
        status: "PUBLISHED",
        weekKey,
        createdById: manager.id,
      },
      {
        id: SHIFT_IDS.laCaseyOtSat,
        locationId: locLa.id,
        startAtUtc: wallUtc(laCaseySatStart),
        endAtUtc: wallUtc(laCaseySatEnd),
        requiredSkillId: skillServer.id,
        headcount: 1,
        isPremium: false,
        status: "PUBLISHED",
        weekKey,
        createdById: manager.id,
      },
      {
        id: SHIFT_IDS.bosTaylorMonA,
        locationId: locBoston.id,
        startAtUtc: wallUtc(bosTaylorMonAStart),
        endAtUtc: wallUtc(bosTaylorMonAEnd),
        requiredSkillId: skillServer.id,
        headcount: 1,
        isPremium: false,
        status: "PUBLISHED",
        weekKey,
        createdById: manager.id,
      },
      {
        id: SHIFT_IDS.bosTaylorMonB,
        locationId: locBoston.id,
        startAtUtc: wallUtc(bosTaylorMonBStart),
        endAtUtc: wallUtc(bosTaylorMonBEnd),
        requiredSkillId: skillServer.id,
        headcount: 1,
        isPremium: false,
        status: "PUBLISHED",
        weekKey,
        createdById: manager.id,
      },
      {
        id: SHIFT_IDS.bosBartOpen,
        locationId: locBoston.id,
        startAtUtc: wallUtc(bosBartStart),
        endAtUtc: wallUtc(bosBartEnd),
        requiredSkillId: skillBar.id,
        headcount: 1,
        isPremium: true,
        status: "PUBLISHED",
        weekKey,
        createdById: manager.id,
      },
      {
        id: SHIFT_IDS.nyQuinnMonA,
        locationId: locNy.id,
        startAtUtc: wallUtc(nyQuinnMonAStart),
        endAtUtc: wallUtc(nyQuinnMonAEnd),
        requiredSkillId: skillHost.id,
        headcount: 1,
        isPremium: false,
        status: "PUBLISHED",
        weekKey,
        createdById: manager.id,
      },
      {
        id: SHIFT_IDS.nyQuinnMonB,
        locationId: locNy.id,
        startAtUtc: wallUtc(nyQuinnMonBStart),
        endAtUtc: wallUtc(nyQuinnMonBEnd),
        requiredSkillId: skillHost.id,
        headcount: 1,
        isPremium: false,
        status: "PUBLISHED",
        weekKey,
        createdById: manager.id,
      },
      {
        id: SHIFT_IDS.sfOvernightFri,
        locationId: locSf.id,
        startAtUtc: wallUtc(shiftSfOvernightStart),
        endAtUtc: wallUtc(shiftSfOvernightEnd),
        requiredSkillId: skillBar.id,
        headcount: 1,
        isPremium: false,
        status: "PUBLISHED",
        weekKey,
        createdById: manager.id,
      },
    ],
  });

  const dropExpires = DateTime.now().plus({ hours: 36 }).toJSDate();

  await prisma.shiftAssignment.createMany({
    data: [
      { shiftId: SHIFT_IDS.sfServerPartial, staffUserId: staffSam.id, status: "ASSIGNED" },
      { shiftId: SHIFT_IDS.sfBartenderFull, staffUserId: staffJordan.id, status: "ASSIGNED" },
      { shiftId: SHIFT_IDS.sfServerDraft, staffUserId: staffPat.id, status: "PROPOSED" },
      { shiftId: SHIFT_IDS.nyHost, staffUserId: staffQuinn.id, status: "ASSIGNED" },
      { shiftId: SHIFT_IDS.nyServer, staffUserId: staffJamie.id, status: "ASSIGNED" },
      { shiftId: SHIFT_IDS.sfWedDrop, staffUserId: staffTaylor.id, status: "ASSIGNED" },
      { shiftId: SHIFT_IDS.sfJamieOverlapA, staffUserId: staffJamie.id, status: "ASSIGNED" },
      { shiftId: SHIFT_IDS.sfJamieOverlapB, staffUserId: staffJamie.id, status: "ASSIGNED" },
      { shiftId: SHIFT_IDS.sfJamieRestMon, staffUserId: staffJamie.id, status: "ASSIGNED" },
      { shiftId: SHIFT_IDS.sfJamieRestTue, staffUserId: staffJamie.id, status: "ASSIGNED" },
      { shiftId: SHIFT_IDS.sfSatLongJamie, staffUserId: staffJamie.id, status: "ASSIGNED" },
      { shiftId: SHIFT_IDS.laLineCookThu, staffUserId: staffDrew.id, status: "ASSIGNED" },
      { shiftId: SHIFT_IDS.laCaseyOtMon, staffUserId: staffCasey.id, status: "ASSIGNED" },
      { shiftId: SHIFT_IDS.laCaseyOtTue, staffUserId: staffCasey.id, status: "ASSIGNED" },
      { shiftId: SHIFT_IDS.laCaseyOtWed, staffUserId: staffCasey.id, status: "ASSIGNED" },
      { shiftId: SHIFT_IDS.laCaseyOtThu, staffUserId: staffCasey.id, status: "ASSIGNED" },
      { shiftId: SHIFT_IDS.laCaseyOtFri, staffUserId: staffCasey.id, status: "ASSIGNED" },
      { shiftId: SHIFT_IDS.laCaseyOtSat, staffUserId: staffCasey.id, status: "ASSIGNED" },
      { shiftId: SHIFT_IDS.bosTaylorMonA, staffUserId: staffTaylor.id, status: "ASSIGNED" },
      { shiftId: SHIFT_IDS.nyQuinnMonA, staffUserId: staffQuinn.id, status: "ASSIGNED" },
      { shiftId: SHIFT_IDS.sfOvernightFri, staffUserId: staffTaylor.id, status: "ASSIGNED" },
    ],
  });

  await prisma.coverageRequest.createMany({
    data: [
      {
        type: "SWAP",
        shiftId: SHIFT_IDS.sfServerPartial,
        secondShiftId: SHIFT_IDS.sfBartenderFull,
        requesterId: staffSam.id,
        targetId: staffJordan.id,
        status: "PENDING",
      },
      {
        type: "DROP",
        shiftId: SHIFT_IDS.sfWedDrop,
        secondShiftId: null,
        requesterId: staffTaylor.id,
        targetId: null,
        status: "PENDING",
        calloutMode: "OPEN",
        expiresAt: dropExpires,
      },
    ],
  });

  const partialStartUtc = shiftSfPartialStart.toUTC();
  if (partialStartUtc <= DateTime.utc()) {
    await prisma.clockSession.create({
      data: {
        staffUserId: staffSam.id,
        shiftId: SHIFT_IDS.sfServerPartial,
        clockInAtUtc: partialStartUtc.minus({ minutes: 5 }).toJSDate(),
        clockOutAtUtc: null,
      },
    });
  }

  console.log("Seed OK — next ISO week (Mon–Sun); multi-location + constraint + coverage scenarios.");
  console.log({
    weekKey,
    weekStarts: { sf: weekStartSf, la: weekStartLa, ny: weekStartNy, boston: weekStartNy },
    accounts: {
      password: "password123",
      manager: "manager@coastaleats.test (SF+LA+NYC+Boston)",
      admin: "admin@coastaleats.test",
      staff: "sam@, jordan@, casey@, riley@, jamie@, pat@, quinn@, taylor@, drew@, eve@coastaleats.test",
    },
    scenarios: {
      byLocation: {
        sf: "Overlap + 10h rest + Sat 12h+ day + Wed unavail (Sam) + overnight Fri→Sat bar (Taylor) + swap/drop queue",
        la: "Casey Mon–Sat server stack (~47h) → Analytics OT + WEEKLY_WARN on more assigns · line cook understaffed Thu",
        nyc: "Thu host+server · Mon Quinn host A assigned — preview assign Quinn on Mon B → DAILY_WARN_8H",
        boston: "Taylor Mon A assigned — preview Taylor on Mon B → DAILY_WARN_8H · Sat bartender OPEN — preview Pat → NOT_CERTIFIED",
      },
      sfServerDraft: "DRAFT · Pat PROPOSED (publish / assign flows)",
      sfServerPartial: "PUBLISHED · Sam ASSIGNED + PENDING SWAP with Jordan’s Fri bar shift",
      sfBartenderFull: "PUBLISHED premium · Jordan ASSIGNED",
      laBartenderDraft: "DRAFT LA bartender · Riley eligible",
      nyHost_nyServer: "NYC Thu · Quinn host + Jamie server",
      sfWedDrop: "PUBLISHED · Taylor + PENDING DROP (OPEN callout)",
      jamieOverlap: "Thu · Jamie double-booked (overlap) — constraint: DOUBLE_BOOK",
      jamieRest: "Mon eve + Tue early · Jamie — constraint: REST_10H",
      jamieSatLong: "Sat · Jamie 13h single shift — DAILY_HARD_12H / warnings",
      laLineCookThu: "LA Thu · line cook headcount 2 · Drew assigned (1 open)",
      laCaseyOt: "LA · Casey 47h week — projected OT dollars (FIFO) at LA in Analytics / Manager home",
      samWedOff: "Sam UNAVAILABLE all Wed (SF) — new Wed assignments blocked",
      eveWeekend: "Eve — server SF cert · availability Sat/Sun only",
      analytics: "Location default hourly rates + Sam/Jordan wage overrides",
      clock: "Sam clocked in on Tue partial shift (open session)",
    },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
