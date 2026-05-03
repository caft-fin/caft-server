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

  // ── 2. Create Demo User ─────────────────────────────

  const demoUser = await prisma.user.upsert({
    where: { email: 'aditya.v@caftfinancial.com' },
    update: {},
    create: {
      email: 'aditya.v@caftfinancial.com',
      name: 'Aditya Sharma',
      phone: '+919876543210',
      role: Role.USER,
      isActive: true,
      isEmailVerified: true,
      kycVerified: true,
      twoFactorEnabled: true,
      referralCode: 'CAFT_ADITYA77',
    },
  });
  console.log(`✅ Demo user: ${demoUser.email}`);

  // ── 3. Create Subscription Plans ────────────────────

  // Basic Plan (Free)
  const basicPlan = await prisma.plan.upsert({
    where: { slug: 'basic' },
    update: {},
    create: {
      name: 'Basic',
      slug: 'basic',
      description: 'Perfect for individuals starting their financial tracking journey.',
      planType: 'FREE',
      isPopular: false,
      sortOrder: 1,
      features: {
        create: [
          { name: 'Personal Expense Tracking', included: true },
          { name: 'Basic Savings Goals', included: true },
          { name: 'Monthly Statements', included: true },
          { name: 'Active Accounts', included: true, value: '2' },
          { name: 'Market Insights', included: false },
          { name: 'Real-time Data', included: false },
          { name: 'Wealth Coaching', included: false },
          { name: 'Custom Dashboards', included: false },
        ],
      },
    },
  });
  console.log(`✅ Plan: ${basicPlan.name} (Free)`);

  // Pro Plan
  const proPlan = await prisma.plan.upsert({
    where: { slug: 'pro' },
    update: {},
    create: {
      name: 'Pro',
      slug: 'pro',
      description: 'Advanced tools for serious investors and family wealth growth.',
      planType: 'PAID',
      isPopular: true,
      sortOrder: 2,
      features: {
        create: [
          { name: 'Everything in Basic', included: true },
          { name: 'Stock Portfolio Sync', included: true },
          { name: 'AI-Powered Market Insights', included: true },
          { name: 'Tax Optimization Reports', included: true },
          { name: 'Active Accounts', included: true, value: '10' },
          { name: 'Real-time Data', included: true },
          { name: 'Wealth Coaching', included: true, value: 'Monthly' },
          { name: 'Custom Dashboards', included: true, value: 'Limited' },
        ],
      },
      pricing: {
        create: [
          { billingCycle: 'MONTHLY', price: 99900 },
          { billingCycle: 'ANNUALLY', price: 959900 },
        ],
      },
    },
  });
  console.log(`✅ Plan: ${proPlan.name}`);

  // Institutional Plan
  const instPlan = await prisma.plan.upsert({
    where: { slug: 'institutional' },
    update: {},
    create: {
      name: 'Institutional',
      slug: 'institutional',
      description: 'Comprehensive suite for wealth managers and large organizations.',
      planType: 'PAID',
      isPopular: false,
      sortOrder: 3,
      features: {
        create: [
          { name: 'Unlimited Portfolios', included: true },
          { name: 'Custom API Access', included: true },
          { name: 'Dedicated Advisor Support', included: true },
          { name: 'Audit-Ready Compliance', included: true },
          { name: 'Active Accounts', included: true, value: 'Unlimited' },
          { name: 'Real-time Data', included: true },
          { name: 'Wealth Coaching', included: true, value: 'Priority 24/7' },
          { name: 'Custom Dashboards', included: true, value: 'Full Access' },
        ],
      },
      pricing: {
        create: [
          { billingCycle: 'MONTHLY', price: 499900 },
          { billingCycle: 'ANNUALLY', price: 4799900 },
        ],
      },
    },
  });
  console.log(`✅ Plan: ${instPlan.name}`);

  // ── 4. Create Notification Preferences ──────────────

  await prisma.notificationPreference.upsert({
    where: { userId: demoUser.id },
    update: {},
    create: {
      userId: demoUser.id,
      monthlyStatements: true,
      transactionAlerts: true,
      promotionalOffers: false,
      immediatePaymentAlerts: true,
      securityLogins: true,
      billReminders: true,
    },
  });
  console.log(`✅ Notification preferences for demo user`);

  // ── 5. Create Linked Bank Accounts ──────────────────

  await prisma.linkedAccount.createMany({
    data: [
      { userId: demoUser.id, bankName: 'HDFC Bank', bankAbbr: 'HDFC', accountName: 'HDFC Savings', last4: '4421', accountType: 'savings', colorClass: 'bg-blue-600' },
      { userId: demoUser.id, bankName: 'ICICI Bank', bankAbbr: 'ICICI', accountName: 'ICICI Corporate', last4: '8902', accountType: 'corporate', colorClass: 'bg-red-600' },
    ],
    skipDuplicates: true,
  });
  console.log(`✅ Linked bank accounts for demo user`);

  // ── 6. Create Sample Transactions ───────────────────

  await prisma.transaction.createMany({
    data: [
      { userId: demoUser.id, title: 'HDFC Top 100 Fund', subtitle: 'Mutual Fund SIP • Today', amount: 15000.00, type: 'debit', status: 'Success', icon: 'account_balance' },
      { userId: demoUser.id, title: 'Digital Gold Purchase', subtitle: 'Commodity • Yesterday', amount: 5000.00, type: 'debit', status: 'Success', icon: 'grid_goldenratio' },
      { userId: demoUser.id, title: 'Dividend Payout', subtitle: 'Stock Income • 2 days ago', amount: 1240.50, type: 'credit', status: 'Settled', icon: 'download' },
    ],
    skipDuplicates: true,
  });
  console.log(`✅ Sample transactions`);

  // ── 7. Create Admin Settings ────────────────────────

  const settings = [
    { key: 'appName', value: 'CAFT Financial' },
    { key: 'timezone', value: '(GMT+05:30) Indian Standard Time' },
    { key: 'supportEmail', value: 'ops@caft.financial' },
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
