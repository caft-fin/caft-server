// ─────────────────────────────────────────────────────────
// CAFT Financial — Prisma Seed Script
// ─────────────────────────────────────────────────────────

import { PrismaClient, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding CAFT Financial database...\n');

  // ── 1. Create Admin User ────────────────────────────

  const adminPassword = await bcrypt.hash('Admin@CAFT2024', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@caft.financial' },
    update: {},
    create: {
      email: 'admin@caft.financial',
      name: 'Sai krishna',
      role: Role.ADMIN,
      passwordHash: adminPassword,
      isActive: true,
      isEmailVerified: true,
      kycVerified: true,
      isSuperAdmin: true,  // ← Only this account can create other admins
      referralCode: 'CAFT_ADMIN01',
    },
  });
  console.log(`✅ Superadmin: ${admin.email} (isSuperAdmin: true)`);




  // ── 7. Create Admin Settings ────────────────────────

  const settings = [
    { key: 'appName', value: 'CAFT Financial' },
    { key: 'timezone', value: '(GMT+05:30) Indian Standard Time' },
    { key: 'supportEmail', value: 'support@caftfin.com' },
    { key: 'twoFactorRequired', value: 'true' },
    { key: 'minPasswordLength', value: '12' },
    { key: 'requireSpecialChars', value: 'true' },
    { key: 'forcePasswordReset', value: 'false' },
  ];

  for (const setting of settings) {
    await prisma.adminSetting.upsert({
      where: { key: setting.key },
      update: { value: setting.value },
      create: setting,
    });
  }
  console.log(`✅ Admin settings`);

  // ── 8. Create Sample Email Templates ────────────────

  await prisma.emailTemplate.createMany({
    data: [
      {
        name: 'Investor Update',
        subject: 'Your Monthly Investment Update',
        htmlContent: '<html><body><h1>Monthly Investment Summary</h1><p>Dear {{name}}, here is your investment update...</p></body></html>',
      },
      {
        name: 'Welcome Series',
        subject: 'Welcome to CAFT Financial',
        htmlContent: '<html><body><h1>Welcome!</h1><p>Dear {{name}}, welcome to CAFT Financial...</p></body></html>',
      },
    ],
    skipDuplicates: true,
  });
  console.log(`✅ Email templates`);

  console.log('\n🎉 Seeding completed!\n');
  console.log('Admin credentials:');
  console.log('  Email:    admin@caft.financial');
  console.log('  Password: Admin@CAFT2024\n');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
