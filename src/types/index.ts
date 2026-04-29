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

export interface RazorpayWebhookPayload {
  entity: string;
  account_id: string;
  event: string;
  contains: string[];
  payload: {
    payment?: { entity: RazorpayPaymentEntity };
    subscription?: { entity: RazorpaySubscriptionEntity };
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

export interface CreatePlanInput {
  name: string;
  slug: string;
  description: string;
  priceMonthly: number;
  priceYearly: number;
  currency?: string;
  isPopular?: boolean;
  trialPeriodDays?: number;
  sortOrder?: number;
  features: {
    name: string;
    included: boolean;
    value?: string;
  }[];
}

export interface UpdatePlanInput {
  name?: string;
  description?: string;
  priceMonthly?: number;
  priceYearly?: number;
  isPopular?: boolean;
  isActive?: boolean;
  trialPeriodDays?: number | null;
  sortOrder?: number;
  features?: {
    id?: string;
    name: string;
    included: boolean;
    value?: string;
  }[];
}

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
