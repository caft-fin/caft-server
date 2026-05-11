// ─────────────────────────────────────────────────────────
// CAFT Financial — General Utilities
// ─────────────────────────────────────────────────────────

import crypto from 'crypto';

/**
 * Generate a 6-digit numeric OTP
 */
export function generateOtp(): string {
  return crypto.randomInt(100000, 999999).toString();
}

/**
 * Generate a unique referral code for a user
 */
export function generateReferralCode(name: string): string {
  const cleanName = name.replace(/\s+/g, '_').toUpperCase().slice(0, 10);
  const suffix = crypto.randomInt(10, 99);
  return `CAFT_${cleanName}${suffix}`;
}

/**
 * Convert amount from paise to formatted INR string
 */
export function formatCurrency(amountInPaise: number, currency = 'INR'): string {
  const amount = amountInPaise / 100;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Slugify a string
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Compute pagination metadata
 */
export function computePagination(total: number, page: number, limit: number) {
  const totalPages = Math.ceil(total / limit);
  return {
    total,
    page,
    limit,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

/**
 * Verify Razorpay webhook signature
 */
export function verifyRazorpaySignature(
  body: string,
  signature: string,
  secret: string
): boolean {
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature),
      Buffer.from(signature)
    );
  } catch {
    // timingSafeEqual throws if buffer lengths differ — signatures don't match
    return false;
  }
}

/**
 * Verify Razorpay payment signature (for checkout verification)
 */
export function verifyPaymentSignature(
  orderId: string,
  paymentId: string,
  signature: string,
  secret: string
): boolean {
  const body = `${orderId}|${paymentId}`;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature),
      Buffer.from(signature)
    );
  } catch {
    return false;
  }
}

/**
 * Mask an email address for display
 */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (local.length <= 2) return `${local[0]}***@${domain}`;
  return `${local[0]}${local[1]}${'*'.repeat(local.length - 2)}@${domain}`;
}

/**
 * Calculate date N days from now
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Generate a unique order reference
 */
export function generateOrderRef(): string {
  const prefix = 'CAFT';
  const num = crypto.randomInt(1000, 9999);
  const suffix = String.fromCharCode(65 + crypto.randomInt(0, 26));
  return `${prefix}-${num}-${suffix}`;
}
