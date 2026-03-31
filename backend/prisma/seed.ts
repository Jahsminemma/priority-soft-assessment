import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

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

  const locMia = await prisma.location.upsert({
    where: { id: "a0000000-0000-4000-8000-000000000004" },
    update: {},
    create: {
      id: "a0000000-0000-4000-8000-000000000004",
      name: "Coastal Eats — Miami",
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
  await prisma.skill.upsert({
    where: { id: "b0000000-0000-4000-8000-000000000003" },
    update: {},
    create: { id: "b0000000-0000-4000-8000-000000000003", name: "line_cook" },
  });
  await prisma.skill.upsert({
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
    ],
  });

  const staffSam = await prisma.user.upsert({
    where: { email: "sam@coastaleats.test" },
    update: {},
    create: {
      id: "c0000000-0000-4000-8000-000000000010",
      email: "sam@coastaleats.test",
      passwordHash,
      name: "Sam Server",
      role: "STAFF",
      desiredHoursWeekly: 32,
    },
  });

  const staffJordan = await prisma.user.upsert({
    where: { email: "jordan@coastaleats.test" },
    update: {},
    create: {
      id: "c0000000-0000-4000-8000-000000000011",
      email: "jordan@coastaleats.test",
      passwordHash,
      name: "Jordan Bartender",
      role: "STAFF",
      desiredHoursWeekly: 28,
    },
  });

  await prisma.staffSkill.deleteMany({
    where: { userId: { in: [staffSam.id, staffJordan.id] } },
  });
  await prisma.staffSkill.createMany({
    data: [
      { userId: staffSam.id, skillId: skillServer.id },
      { userId: staffJordan.id, skillId: skillBar.id },
      { userId: staffJordan.id, skillId: skillServer.id },
    ],
  });

  await prisma.staffCertification.deleteMany({
    where: { userId: { in: [staffSam.id, staffJordan.id] } },
  });
  await prisma.staffCertification.createMany({
    data: [
      { userId: staffSam.id, locationId: locSf.id },
      { userId: staffSam.id, locationId: locNy.id },
      { userId: staffJordan.id, locationId: locSf.id },
    ],
  });

  await prisma.availabilityRule.deleteMany({
    where: { userId: { in: [staffSam.id, staffJordan.id] } },
  });
  await prisma.availabilityRule.createMany({
    data: [
      { userId: staffSam.id, dayOfWeek: 0, startLocalTime: "09:00", endLocalTime: "23:59" },
      { userId: staffSam.id, dayOfWeek: 1, startLocalTime: "09:00", endLocalTime: "23:59" },
      { userId: staffSam.id, dayOfWeek: 2, startLocalTime: "09:00", endLocalTime: "23:59" },
      { userId: staffSam.id, dayOfWeek: 3, startLocalTime: "09:00", endLocalTime: "23:59" },
      { userId: staffSam.id, dayOfWeek: 4, startLocalTime: "09:00", endLocalTime: "23:59" },
      { userId: staffSam.id, dayOfWeek: 5, startLocalTime: "09:00", endLocalTime: "23:59" },
      { userId: staffSam.id, dayOfWeek: 6, startLocalTime: "09:00", endLocalTime: "23:59" },
      ...[0, 1, 2, 3, 4, 5, 6].map((d) => ({
        userId: staffJordan.id,
        dayOfWeek: d,
        startLocalTime: "09:00",
        endLocalTime: "23:59",
      })),
    ],
  });

  const weekKey = "2026-W09";
  const shiftServer = await prisma.shift.upsert({
    where: { id: "d0000000-0000-4000-8000-000000000001" },
    update: {},
    create: {
      id: "d0000000-0000-4000-8000-000000000001",
      locationId: locSf.id,
      startAtUtc: new Date("2026-03-02T23:00:00Z"),
      endAtUtc: new Date("2026-03-03T03:00:00Z"),
      requiredSkillId: skillServer.id,
      headcount: 2,
      isPremium: false,
      status: "PUBLISHED",
      weekKey,
      createdById: manager.id,
    },
  });

  await prisma.shiftAssignment.deleteMany({ where: { shiftId: shiftServer.id } });

  console.log("Seed OK", { admin: admin.email, manager: manager.email, shift: shiftServer.id });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
