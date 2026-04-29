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

// ── Plan Validators ──────────────────────────────────────

export const createPlanSchema = z.object({
  name: z.string().min(1, 'Plan name is required').max(100),
  slug: z.string().min(1, 'Slug is required').max(50).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  description: z.string().min(1, 'Description is required').max(500),
  priceMonthly: z.number().int().min(0, 'Monthly price must be non-negative'),
  priceYearly: z.number().int().min(0, 'Yearly price must be non-negative'),
  currency: z.string().length(3).default('INR'),
  isPopular: z.boolean().default(false),
  trialPeriodDays: z.number().int().min(0).max(365).optional(),
  sortOrder: z.number().int().default(0),
  features: z.array(z.object({
    name: z.string().min(1, 'Feature name is required'),
    included: z.boolean(),
    value: z.string().optional(),
  })).min(1, 'At least one feature is required'),
});

export const updatePlanSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().min(1).max(500).optional(),
  priceMonthly: z.number().int().min(0).optional(),
  priceYearly: z.number().int().min(0).optional(),
  isPopular: z.boolean().optional(),
  isActive: z.boolean().optional(),
  trialPeriodDays: z.number().int().min(0).max(365).optional().nullable(),
  sortOrder: z.number().int().optional(),
  features: z.array(z.object({
    id: z.string().optional(),
    name: z.string().min(1),
    included: z.boolean(),
    value: z.string().optional(),
  })).optional(),
});

export const updatePricingSchema = z.object({
  priceMonthly: z.number().int().min(0).optional(),
  priceYearly: z.number().int().min(0).optional(),
});

export const updateFeaturesSchema = z.object({
  features: z.array(z.object({
    id: z.string().optional(),
    name: z.string().min(1),
    included: z.boolean(),
    value: z.string().optional(),
  })).min(1, 'At least one feature is required'),
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
  planId: z.string().uuid('Invalid plan ID'),
  billingCycle: z.enum(['MONTHLY', 'YEARLY']),
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
  appName: z.string().min(1).max(100).optional(),
  timezone: z.string().optional(),
  supportEmail: z.string().email().optional(),
  twoFactorRequired: z.boolean().optional(),
  minPasswordLength: z.number().int().min(8).max(128).optional(),
  requireSpecialChars: z.boolean().optional(),
  forcePasswordReset: z.boolean().optional(),
  passwordResetDays: z.number().int().min(30).max(365).optional(),
});

// ── Pagination Validator ─────────────────────────────────

export const paginationSchema = z.object({
  page: z.string().transform(Number).pipe(z.number().int().min(1)).default('1'),
  limit: z.string().transform(Number).pipe(z.number().int().min(1).max(100)).default('10'),
  sortBy: z.string().optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  search: z.string().optional(),
});
