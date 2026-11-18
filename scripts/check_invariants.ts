import { PrismaClient } from '../backend/node_modules/@prisma/client';

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL || "postgresql://darrow:root@localhost:5432/darrow_dev"
    }
  }
});

async function main() {
  const [dbRow]: any = await prisma.$queryRawUnsafe('SELECT current_database(), current_user;');
  console.log('SAFETY DB CHECK:', dbRow);

  const duplicates: any[] = await prisma.$queryRawUnsafe(
    'SELECT "userId", COUNT(*) AS membership_count FROM "CompanyMembership" GROUP BY "userId" HAVING COUNT(*) > 1;'
  );
  console.log('DUPLICATE MEMBERSHIPS FOUND:', duplicates.length);

  const totalMemberships = await prisma.companyMembership.count();
  const totalUsers = await prisma.user.count();
  console.log('TOTAL USERS:', totalUsers, 'TOTAL MEMBERSHIPS:', totalMemberships);

  await prisma.$disconnect();
  if (duplicates.length > 0) {
    console.error('INVARIANT VIOLATION: duplicate memberships exist!');
    process.exit(1);
  }
  console.log('INVARIANT VERIFIED: 0 duplicate memberships.');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
