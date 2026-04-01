import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
import { DateTime } from "luxon";

dotenv.config();

const prisma = new PrismaClient();

/** Fixed shift row ids (see frontend/src/constants.ts SEED). */
const SHIFT_IDS = {
  sfServerDraft: "d0000000-0000-4000-8000-000000000001",
  sfServerPartial: "d0000000-0000-4000-8000-000000000002",
  sfBartenderFull: "d0000000-0000-4000-8000-000000000003",
  laBartenderDraft: "d0000000-0000-4000-8000-000000000004",
} as const;

async function main(): Promise<void> {
  const passwordHash = await bcrypt.hash("password123", 10);

  const locSf = await prisma.location.upsert({
    where: { id: "a0000000-0000-4000-8000-000000000001" },
    update: {},
    create: {
      id: "a0000000-0000-4000-8000-000000000001",
      name: "Coastal Eats — SF",
      tzIana: "America/Los_Angeles",
    },
  });

  const locLa = await prisma.location.upsert({
    where: { id: "a0000000-0000-4000-8000-000000000002" },
    update: {},
    create: {
      id: "a0000000-0000-4000-8000-000000000002",
      name: "Coastal Eats — LA",
      tzIana: "America/Los_Angeles",
    },
  });

  const locNy = await prisma.location.upsert({
    where: { id: "a0000000-0000-4000-8000-000000000003" },
    update: {},
    create: {
      id: "a0000000-0000-4000-8000-000000000003",
      name: "Coastal Eats — NYC",
      tzIana: "America/New_York",
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

  const admin = await prisma.user.upsert({
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
    ],
  });

  const staffSam = await prisma.user.upsert({
    where: { email: "sam@coastaleats.test" },
    update: { name: "Sam Rivera" },
    create: {
      id: "c0000000-0000-4000-8000-000000000010",
      email: "sam@coastaleats.test",
      passwordHash,
      name: "Sam Rivera",
      role: "STAFF",
      desiredHoursWeekly: 32,
    },
  });

  const staffJordan = await prisma.user.upsert({
    where: { email: "jordan@coastaleats.test" },
    update: { name: "Jordan Lee" },
    create: {
      id: "c0000000-0000-4000-8000-000000000011",
      email: "jordan@coastaleats.test",
      passwordHash,
      name: "Jordan Lee",
      role: "STAFF",
      desiredHoursWeekly: 28,
    },
  });

  /** Server skill + LA cert only — excluded from SF roster; use to test location filter. */
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

  /** Bartender + LA cert only — roster for LA bartender shifts; not on SF. */
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

  /** Extra staff for UI-created shifts (morning or night) — full local-day availability below. */
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
    ],
  });

  await prisma.staffCertification.deleteMany({
    where: { userId: { in: staffIds } },
  });
  await prisma.staffCertification.createMany({
    data: [
      { userId: staffSam.id, locationId: locSf.id },
      { userId: staffSam.id, locationId: locNy.id },
      { userId: staffJordan.id, locationId: locSf.id },
      { userId: staffJordan.id, locationId: locNy.id },
      { userId: staffCasey.id, locationId: locLa.id },
      { userId: staffRiley.id, locationId: locLa.id },
      { userId: staffJamie.id, locationId: locSf.id },
      { userId: staffJamie.id, locationId: locLa.id },
      { userId: staffJamie.id, locationId: locNy.id },
      { userId: staffPat.id, locationId: locSf.id },
      { userId: staffPat.id, locationId: locLa.id },
      { userId: staffPat.id, locationId: locNy.id },
      { userId: staffQuinn.id, locationId: locSf.id },
      { userId: staffQuinn.id, locationId: locLa.id },
      { userId: staffQuinn.id, locationId: locNy.id },
      { userId: staffTaylor.id, locationId: locSf.id },
      { userId: staffTaylor.id, locationId: locLa.id },
      { userId: staffTaylor.id, locationId: locNy.id },
      { userId: staffDrew.id, locationId: locSf.id },
      { userId: staffDrew.id, locationId: locLa.id },
    ],
  });

  const days = [0, 1, 2, 3, 4, 5, 6] as const;
  await prisma.availabilityRule.deleteMany({
    where: { userId: { in: staffIds } },
  });
  /** Full local calendar day so early-morning and late-night shifts you add in the UI still pass availability checks. */
  await prisma.availabilityRule.createMany({
    data: staffIds.flatMap((userId) =>
      days.map((dayOfWeek) => ({
        userId,
        dayOfWeek,
        startLocalTime: "00:00",
        endLocalTime: "23:59",
      })),
    ),
  });

  const zoneSf = locSf.tzIana;
  const now = DateTime.now().setZone(zoneSf);
  const weekYear = now.weekYear;
  const weekNumber = now.weekNumber;
  const weekKey = `${weekYear}-W${String(weekNumber).padStart(2, "0")}`;

  const monSf = DateTime.fromObject({ weekYear, weekNumber }, { zone: zoneSf }).startOf("week");

  const wallUtc = (wall: DateTime): Date => wall.toUTC().toJSDate();

  const shiftSfDraftStart = monSf.set({ hour: 17, minute: 0, second: 0, millisecond: 0 });
  const shiftSfDraftEnd = monSf.set({ hour: 22, minute: 0, second: 0, millisecond: 0 });

  const tueSf = monSf.plus({ days: 1 });
  const shiftSfPartialStart = tueSf.set({ hour: 11, minute: 0, second: 0, millisecond: 0 });
  const shiftSfPartialEnd = tueSf.set({ hour: 15, minute: 0, second: 0, millisecond: 0 });

  const friSf = monSf.plus({ days: 4 });
  const shiftSfBarStart = friSf.set({ hour: 18, minute: 0, second: 0, millisecond: 0 });
  const shiftSfBarEnd = friSf.set({ hour: 23, minute: 0, second: 0, millisecond: 0 });

  const wedLa = monSf.plus({ days: 2 });
  const shiftLaBarStart = wedLa.set({ hour: 16, minute: 0, second: 0, millisecond: 0 });
  const shiftLaBarEnd = wedLa.set({ hour: 21, minute: 0, second: 0, millisecond: 0 });

  const weekStartSf = monSf.toFormat("yyyy-LL-dd");
  const weekStartLa = DateTime.fromObject({ weekYear, weekNumber }, { zone: locLa.tzIana })
    .startOf("week")
    .toFormat("yyyy-LL-dd");

  await prisma.shiftAssignment.deleteMany({
    where: { shiftId: { in: Object.values(SHIFT_IDS) } },
  });
  await prisma.shift.deleteMany({
    where: { id: { in: Object.values(SHIFT_IDS) } },
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
    ],
  });

  await prisma.shiftAssignment.createMany({
    data: [
      { shiftId: SHIFT_IDS.sfServerPartial, staffUserId: staffSam.id, status: "ASSIGNED" },
      { shiftId: SHIFT_IDS.sfBartenderFull, staffUserId: staffJordan.id, status: "ASSIGNED" },
    ],
  });

  console.log("Seed OK — data matches the current ISO week so Schedule / Assignments show it without changing the week.");
  console.log({
    weekKey,
    weekStartSf,
    locations: { sf: locSf.name, la: locLa.name },
    shifts: {
      sfServerDraft: "DRAFT server SF · headcount 2 · no assignments (assign & publish flow)",
      sfServerPartial: "PUBLISHED server SF · headcount 2 · Sam assigned (1 open slot)",
      sfBartenderFull: "PUBLISHED bartender SF · headcount 1 · Jordan assigned (fully staffed)",
      laBartenderDraft: "DRAFT bartender LA · headcount 1 · no assignment (Riley is eligible in roster)",
    },
    staff: {
      sam: "server · SF + NYC",
      jordan: "bartender+server · SF + NYC (no LA)",
      casey: "server · LA only (not on SF roster)",
      riley: "bartender · LA only (LA bartender roster)",
      jamie: "server · SF + LA + NYC",
      pat: "bartender · SF + LA + NYC",
      quinn: "host · SF + LA + NYC",
      taylor: "server+bartender · SF + LA + NYC",
      drew: "line_cook · SF + LA",
    },
    accounts:
      "password123 — manager@… (SF+LA+NYC), sam@…, jordan@…, casey@…, riley@…, jamie@…, pat@…, quinn@…, taylor@…, drew@…",
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
