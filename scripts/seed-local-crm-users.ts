import { PrismaClient } from "@prisma/client";
import * as bcrypt from "bcrypt";

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL || "postgresql://darrow:darrow_dev@localhost:5432/darrow_dev?schema=public",
    },
  },
});

async function main() {
  console.log("Seeding local CRM test users and companies into PostgreSQL 'darrow_dev'...");

  const passwordHash = await bcrypt.hash("Password123!", 10);

  // 1. Company A
  const companyA = await prisma.company.upsert({
    where: { id: "company-alpha-101" },
    update: { name: "Alpha Dynamics Ltd" },
    create: {
      id: "company-alpha-101",
      name: "Alpha Dynamics Ltd",
    },
  });

  const userA = await prisma.user.upsert({
    where: { email: "alpha-admin@darrow.local" },
    update: {
      name: "Alpha Admin",
      passwordHash,
      companyId: companyA.id,
      role: "ADMIN",
    },
    create: {
      id: "user-alpha-101",
      email: "alpha-admin@darrow.local",
      name: "Alpha Admin",
      passwordHash,
      companyId: companyA.id,
      role: "ADMIN",
      isPlatformAdmin: false,
    },
  });

  await prisma.companyMembership.upsert({
    where: {
      userId_companyId: {
        userId: userA.id,
        companyId: companyA.id,
      },
    },
    update: { role: "ADMIN", status: "ACTIVE" },
    create: {
      userId: userA.id,
      companyId: companyA.id,
      role: "ADMIN",
      status: "ACTIVE",
    },
  });

  // 2. Company B
  const companyB = await prisma.company.upsert({
    where: { id: "company-beta-202" },
    update: { name: "Beta Global Services" },
    create: {
      id: "company-beta-202",
      name: "Beta Global Services",
    },
  });

  const userB = await prisma.user.upsert({
    where: { email: "beta-admin@darrow.local" },
    update: {
      name: "Beta Admin",
      passwordHash,
      companyId: companyB.id,
      role: "ADMIN",
    },
    create: {
      id: "user-beta-202",
      email: "beta-admin@darrow.local",
      name: "Beta Admin",
      passwordHash,
      companyId: companyB.id,
      role: "ADMIN",
      isPlatformAdmin: false,
    },
  });

  await prisma.companyMembership.upsert({
    where: {
      userId_companyId: {
        userId: userB.id,
        companyId: companyB.id,
      },
    },
    update: { role: "ADMIN", status: "ACTIVE" },
    create: {
      userId: userB.id,
      companyId: companyB.id,
      role: "ADMIN",
      status: "ACTIVE",
    },
  });

  console.log("Seeding complete:");
  console.log("  Company A:", companyA.name, "(id:", companyA.id, ") ->", userA.email);
  console.log("  Company B:", companyB.name, "(id:", companyB.id, ") ->", userB.email);
  console.log("  Password for both: Password123!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
