// ─────────────────────────────────────────────────────────
// CAFT Financial — Zod Validation Schemas
// ─────────────────────────────────────────────────────────

import { z } from 'zod';

// ── Auth Validators ──────────────────────────────────────

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
});

export const verifyOtpSchema = z.object({
  email: z.string().email('Invalid email address'),
  otp: z.string().length(6, 'OTP must be 6 digits'),
});

export const adminLoginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

// ── Billing Cycle Enum ──────────────────────────────────

const billingCycleEnum = z.enum([
  'DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY',
  'QUARTERLY', 'HALFYEARLY', 'ANNUALLY', 'ONETIME',
]);

const planTypeEnum = z.enum(['FREE', 'PAID']);
const itemCategoryEnum = z.enum(['SUBSCRIPTION', 'DIGITAL_PRODUCT', 'PHYSICAL_PRODUCT', 'SERVICE']);
const reviewStatusEnum = z.enum(['PENDING', 'APPROVED', 'REJECTED']);

// ── Plan Pricing Schema ─────────────────────────────────

const planPricingSchema = z.object({
  billingCycle: billingCycleEnum,
  price: z.number().int().min(0, 'Price must be non-negative'),
});

// ── Plan Feature Schema ─────────────────────────────────

const planFeatureSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, 'Feature name is required'),
  included: z.boolean(),
  value: z.string().optional(),
  icon: z.string().optional(),
  sortOrder: z.number().int().default(0),
});

// ── Plan Validators ──────────────────────────────────────

export const createPlanSchema = z.object({
  name: z.string().min(1, 'Plan name is required').max(100),
  slug: z.string().min(1, 'Slug is required').max(50).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  description: z.string().min(1, 'Description is required').max(1000),
  planType: planTypeEnum.default('PAID'),
  itemCategory: itemCategoryEnum.default('SUBSCRIPTION'),
  images: z.array(z.string().url()).optional(),
  stockLimit: z.number().int().min(0).optional(),
  taxPercentage: z.number().min(0).max(100).optional(),
  currency: z.string().length(3).default('INR'),
  bannerBadge: z.string().max(50).optional(),
  isPopular: z.boolean().default(false),
  sortOrder: z.number().int().default(0),

  // One-time purchase
  isOneTime: z.boolean().default(false),
  oneTimePrice: z.number().int().min(0).optional(),

  // Free trial
  freeTrialEnabled: z.boolean().default(false),
  freeTrialDays: z.number().int().min(1).max(365).optional(),

  // Discount
  discountPercent: z.number().min(0).max(100).optional(),
  discountLabel: z.string().max(100).optional(),

  // Pricing for each billing cycle
  pricing: z.array(planPricingSchema).default([]),

  // Features
  features: z.array(planFeatureSchema).min(1, 'At least one feature is required'),
}).refine((data) => {
  // If PAID plan and not one-time, must have at least one pricing entry
  if (data.planType === 'PAID' && !data.isOneTime && data.pricing.length === 0) {
    return false;
  }
  return true;
}, {
  message: 'Paid plans must have at least one pricing duration or be marked as one-time purchase',
  path: ['pricing'],
}).refine((data) => {
  // If one-time, must have oneTimePrice
  if (data.isOneTime && (data.oneTimePrice === undefined || data.oneTimePrice <= 0)) {
    return false;
  }
  return true;
}, {
  message: 'One-time purchase plans must have a valid one-time price',
  path: ['oneTimePrice'],
}).refine((data) => {
  // If trial enabled, must have trial days
  if (data.freeTrialEnabled && (!data.freeTrialDays || data.freeTrialDays <= 0)) {
    return false;
  }
  return true;
}, {
  message: 'Free trial must have a positive number of trial days',
  path: ['freeTrialDays'],
});

export const updatePlanSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/).optional(),
  description: z.string().min(1).max(1000).optional(),
  planType: planTypeEnum.optional(),
  itemCategory: itemCategoryEnum.optional(),
  images: z.array(z.string().url()).optional(),
  stockLimit: z.number().int().min(0).optional().nullable(),
  taxPercentage: z.number().min(0).max(100).optional().nullable(),
  bannerBadge: z.string().max(50).optional().nullable(),
  isPopular: z.boolean().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),

  // One-time purchase
  isOneTime: z.boolean().optional(),
  oneTimePrice: z.number().int().min(0).optional().nullable(),

  // Free trial
  freeTrialEnabled: z.boolean().optional(),
  freeTrialDays: z.number().int().min(1).max(365).optional().nullable(),

  // Discount
  discountPercent: z.number().min(0).max(100).optional().nullable(),
  discountLabel: z.string().max(100).optional().nullable(),

  // Pricing (replaces all existing pricing when provided)
  pricing: z.array(planPricingSchema).optional(),

  // Features (replaces all existing features when provided)
  features: z.array(planFeatureSchema).optional(),
});

export const updatePricingSchema = z.object({
  pricing: z.array(planPricingSchema).min(1, 'At least one pricing entry is required'),
});

export const updateFeaturesSchema = z.object({
  features: z.array(planFeatureSchema).min(1, 'At least one feature is required'),
});

// ── Bundle Validators ────────────────────────────────────

export const createBundleSchema = z.object({
  name: z.string().min(1, 'Bundle name is required').max(100),
  slug: z.string().min(1, 'Slug is required').max(50).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  description: z.string().max(500).optional(),
  price: z.number().int().min(0, 'Price must be non-negative'),
  currency: z.string().length(3).default('INR'),
  planIds: z.array(z.string().uuid()).min(2, 'A bundle must include at least 2 plans'),
});

export const updateBundleSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional().nullable(),
  price: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  planIds: z.array(z.string().uuid()).min(2).optional(),
});

// ── Review Validators ────────────────────────────────────

export const createReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional(),
  planId: z.string().uuid(),
});

export const updateReviewSchema = z.object({
  rating: z.number().int().min(1).max(5).optional(),
  comment: z.string().max(1000).optional().nullable(),
  status: reviewStatusEnum.optional(),
});

// ── User Validators ──────────────────────────────────────

export const updateProfileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  phone: z.string().min(10).max(15).optional(),
  avatarUrl: z.string().url().optional(),
});

export const updateNotificationPrefsSchema = z.object({
  monthlyStatements: z.boolean().optional(),
  transactionAlerts: z.boolean().optional(),
  promotionalOffers: z.boolean().optional(),
  immediatePaymentAlerts: z.boolean().optional(),
  securityLogins: z.boolean().optional(),
  billReminders: z.boolean().optional(),
  systemAlerts: z.boolean().optional(),
  securityNotifications: z.boolean().optional(),
  userActivityReports: z.boolean().optional(),
});

export const updateSecuritySchema = z.object({
  twoFactorEnabled: z.boolean().optional(),
  biometricEnabled: z.boolean().optional(),
});

export const addLinkedAccountSchema = z.object({
  bankName: z.string().min(1, 'Bank name is required'),
  bankAbbr: z.string().min(1).max(10),
  accountName: z.string().min(1, 'Account name is required'),
  last4: z.string().length(4, 'Last 4 digits required'),
  accountType: z.string().optional(),
  colorClass: z.string().optional(),
});

// ── Subscription Validators ──────────────────────────────

export const createSubscriptionSchema = z.object({
  planId: z.string().min(1, 'Plan ID is required'),
  billingCycle: billingCycleEnum,
});

// ── Campaign Validators ──────────────────────────────────

export const createCampaignSchema = z.object({
  name: z.string().min(1, 'Campaign name is required').max(200),
  subject: z.string().min(1, 'Subject is required').max(200),
  templateId: z.string().uuid().optional(),
  htmlContent: z.string().optional(),
  scheduledAt: z.string().datetime().optional(),
  recipientFilter: z.object({
    planIds: z.array(z.string().uuid()).optional(),
    roles: z.array(z.enum(['USER', 'ADMIN'])).optional(),
    isActive: z.boolean().optional(),
  }).optional(),
});

export const updateCampaignSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  subject: z.string().min(1).max(200).optional(),
  templateId: z.string().uuid().optional(),
  htmlContent: z.string().optional(),
  scheduledAt: z.string().datetime().optional().nullable(),
});

export const createTemplateSchema = z.object({
  name: z.string().min(1, 'Template name is required').max(200),
  subject: z.string().min(1, 'Subject is required').max(200),
  htmlContent: z.string().min(1, 'HTML content is required'),
});

export const updateTemplateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  subject: z.string().min(1).max(200).optional(),
  htmlContent: z.string().optional(),
});

// ── Admin Settings Validators ────────────────────────────

export const updateSettingsSchema = z.object({
  // General
  appName: z.string().min(1).max(100).optional(),
  timezone: z.string().optional(),
  supportEmail: z.string().email().optional(),
  twoFactorRequired: z.boolean().optional(),
  minPasswordLength: z.number().int().min(8).max(128).optional(),
  requireSpecialChars: z.boolean().optional(),
  forcePasswordReset: z.boolean().optional(),
  passwordResetDays: z.number().int().min(30).max(365).optional(),
  // Hero Media
  heroMediaType: z.enum(['image', 'video']).optional(),
  heroImageUrl: z.string().optional(),
  heroVideoUrl: z.string().optional(),
  // Logo
  logoType: z.enum(['text', 'svg']).optional(),
  logoSvgUrl: z.string().optional(),
  // Banner / Social Proof
  bannerCompanies: z.string().optional(),       // JSON array of {name, color?}
  bannerColorMode: z.enum(['same', 'random']).optional(),
  bannerDefaultColor: z.string().optional(),
  bannerTextSize: z.string().optional(),
  bannerFontFamily: z.string().optional(),
  // Test Account (admin-configurable override)
  testAccountEnabled: z.string().regex(/^(true|false)$/, 'Must be "true" or "false"').optional(),
  testAccountEmail: z.string().email().optional(),
  testAccountOtp: z.string().length(6, 'OTP must be 6 digits').optional(),
});

// ── Pagination Validator ─────────────────────────────────

export const paginationSchema = z.object({
  page: z.string().transform(Number).pipe(z.number().int().min(1)).default('1'),
  limit: z.string().transform(Number).pipe(z.number().int().min(1).max(100)).default('10'),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().optional(),
});
