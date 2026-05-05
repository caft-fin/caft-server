// ─────────────────────────────────────────────────────────
// CAFT Financial — Shared TypeScript Types
// ─────────────────────────────────────────────────────────

import { Request } from 'express';

export interface JwtPayload {
  userId: string;
  email: string;
  role: 'USER' | 'ADMIN';
  isSuperAdmin: boolean;
}

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
}

export interface PaginationQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  search?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

// ── Razorpay Webhook Types ───────────────────────────────

export interface RazorpayWebhookPayload {
  entity: string;
  account_id: string;
  event: string;
  contains: string[];
  payload: {
    payment?: { entity: RazorpayPaymentEntity };
    subscription?: { entity: RazorpaySubscriptionEntity };
    order?: { entity: RazorpayOrderEntity };
  };
  created_at: number;
}

export interface RazorpayPaymentEntity {
  id: string;
  entity: string;
  amount: number;
  currency: string;
  status: string;
  order_id: string | null;
  invoice_id: string | null;
  method: string;
  description: string | null;
  email: string;
  contact: string;
  error_code: string | null;
  error_description: string | null;
  error_reason: string | null;
  created_at: number;
}

export interface RazorpaySubscriptionEntity {
  id: string;
  entity: string;
  plan_id: string;
  customer_id: string;
  status: string;
  current_start: number | null;
  current_end: number | null;
  ended_at: number | null;
  quantity: number;
  short_url: string;
  created_at: number;
}

export interface RazorpayOrderEntity {
  id: string;
  entity: string;
  amount: number;
  amount_paid: number;
  amount_due: number;
  currency: string;
  receipt: string | null;
  status: string;
  created_at: number;
}

// ── Plan Types ───────────────────────────────────────────

export type BillingCycleType =
  | 'DAILY'
  | 'WEEKLY'
  | 'BIWEEKLY'
  | 'MONTHLY'
  | 'QUARTERLY'
  | 'HALFYEARLY'
  | 'ANNUALLY'
  | 'ONETIME';

export type PlanTypeEnum = 'FREE' | 'PAID';
export type ItemCategoryEnum = 'SUBSCRIPTION' | 'DIGITAL_PRODUCT' | 'PHYSICAL_PRODUCT' | 'SERVICE';
export type ReviewStatusEnum = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface PlanPricingInput {
  billingCycle: BillingCycleType;
  price: number; // in paise
}

export interface PlanFeatureInput {
  id?: string;
  name: string;
  included: boolean;
  value?: string;
  icon?: string;
  sortOrder?: number;
}

export interface CreatePlanInput {
  name: string;
  slug: string;
  description: string;
  planType: PlanTypeEnum;
  itemCategory?: ItemCategoryEnum;
  images?: string[];
  stockLimit?: number;
  taxPercentage?: number;
  currency?: string;
  bannerBadge?: string;
  isPopular?: boolean;
  sortOrder?: number;

  // One-time purchase
  isOneTime?: boolean;
  oneTimePrice?: number; // in paise

  // Free trial
  freeTrialEnabled?: boolean;
  freeTrialDays?: number;

  // Discount
  discountPercent?: number; // 0 to 100
  discountLabel?: string;

  // Pricing for each billing cycle
  pricing: PlanPricingInput[];

  // Features
  features: PlanFeatureInput[];
}

export interface UpdatePlanInput {
  name?: string;
  slug?: string;
  description?: string;
  planType?: PlanTypeEnum;
  itemCategory?: ItemCategoryEnum;
  images?: string[];
  stockLimit?: number | null;
  taxPercentage?: number | null;
  bannerBadge?: string | null;
  isPopular?: boolean;
  isActive?: boolean;
  sortOrder?: number;

  // One-time purchase
  isOneTime?: boolean;
  oneTimePrice?: number | null;

  // Free trial
  freeTrialEnabled?: boolean;
  freeTrialDays?: number | null;

  // Discount
  discountPercent?: number | null;
  discountLabel?: string | null;

  // Pricing for each billing cycle (replaces all pricing)
  pricing?: PlanPricingInput[];

  // Features (replaces all features)
  features?: PlanFeatureInput[];
}

// ── Bundle Types ─────────────────────────────────────────

export interface CreateBundleInput {
  name: string;
  slug: string;
  description?: string;
  price: number; // in paise
  currency?: string;
  planIds: string[]; // IDs of plans to include
}

export interface UpdateBundleInput {
  name?: string;
  description?: string;
  price?: number;
  isActive?: boolean;
  planIds?: string[]; // Replace plan list
}

// ── Campaign Types ───────────────────────────────────────

export interface CreateCampaignInput {
  name: string;
  subject: string;
  templateId?: string;
  htmlContent?: string;
  scheduledAt?: string;
  recipientFilter?: {
    planIds?: string[];
    roles?: string[];
    isActive?: boolean;
  };
}

// ── Review Types ─────────────────────────────────────────

export interface CreateReviewInput {
  rating: number; // 1 to 5
  comment?: string;
  planId: string;
}

export interface UpdateReviewInput {
  rating?: number;
  comment?: string;
  status?: ReviewStatusEnum;
}
