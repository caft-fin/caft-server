// ─────────────────────────────────────────────────────────
// CAFT Financial — Razorpay Service (Plans, Subscriptions, Orders)
// ─────────────────────────────────────────────────────────

import { getRazorpayClient } from '../config/razorpay';
import { env } from '../config/env';
import { AppError } from '../utils/apiResponse';
import { BillingCycleType } from '../types';
import crypto from 'crypto';

/**
 * Maps our BillingCycle enum to Razorpay's period + interval.
 * 
 * Per Razorpay docs (https://razorpay.com/docs/api/payments/subscriptions/create-plan/):
 *   period: daily | weekly | monthly | quarterly | yearly
 *   interval: combined with period defines frequency (min 7 for daily)
 *
 * We use interval multipliers for custom frequencies.
 */
function mapBillingCycleToRazorpay(cycle: BillingCycleType): { period: string; interval: number } {
  switch (cycle) {
    case 'DAILY':      return { period: 'daily', interval: 7 };    // Min daily interval is 7
    case 'WEEKLY':     return { period: 'weekly', interval: 1 };
    case 'BIWEEKLY':   return { period: 'weekly', interval: 2 };   // Every 2 weeks
    case 'MONTHLY':    return { period: 'monthly', interval: 1 };
    case 'QUARTERLY':  return { period: 'quarterly', interval: 1 }; // Use native quarterly
    case 'HALFYEARLY': return { period: 'monthly', interval: 6 };
    case 'ANNUALLY':   return { period: 'yearly', interval: 1 };
    case 'ONETIME':    throw new Error('ONETIME plans do not use Razorpay plans — use orders instead');
    default:           throw new Error(`Unknown billing cycle: ${cycle}`);
  }
}

/**
 * Returns the total count for a subscription based on billing cycle.
 * This determines how many billing cycles the subscription runs for.
 */
function getDefaultTotalCount(cycle: BillingCycleType): number {
  switch (cycle) {
    case 'DAILY':      return 52;   // ~1 year (52 x 7-day intervals)
    case 'WEEKLY':     return 52;   // 1 year of weekly billing
    case 'BIWEEKLY':   return 26;   // 1 year of bi-weekly billing
    case 'MONTHLY':    return 12;   // 1 year of monthly billing
    case 'QUARTERLY':  return 4;    // 1 year of quarterly billing
    case 'HALFYEARLY': return 2;    // 1 year of half-yearly billing
    case 'ANNUALLY':   return 1;    // 1 year
    default:           return 12;
  }
}

export class RazorpayService {
  /**
   * Create a Razorpay plan (plans are immutable in Razorpay).
   *
   * Razorpay API: POST /v1/plans
   * Required: period, interval, item.name, item.amount, item.currency
   * Amount must be in smallest currency unit (paise for INR, min 100 = ₹1)
   */
  static async createPlan(params: {
    name: string;
    amount: number;       // in paise
    currency: string;
    billingCycle: BillingCycleType;
    description?: string;
  }): Promise<string> {
    if (params.billingCycle === 'ONETIME') {
      throw new AppError('One-time plans do not use Razorpay plans', 400);
    }

    // Razorpay requires amount >= 100 paise (₹1)
    if (params.amount < 100) {
      throw new AppError('Plan amount must be at least ₹1 (100 paise)', 400);
    }

    const { period, interval } = mapBillingCycleToRazorpay(params.billingCycle);

    console.log(`\n📋 Creating Razorpay plan: "${params.name}"`);
    console.log(`   Period: ${period}, Interval: ${interval}`);
    console.log(`   Amount: ${params.amount} paise (₹${params.amount / 100})`);
    console.log(`   Currency: ${params.currency}\n`);

    try {
      const razorpay = getRazorpayClient();

      const plan = await razorpay.plans.create({
        period: period as any,
        interval,
        item: {
          name: params.name,
          amount: params.amount,
          currency: params.currency,
          description: params.description || params.name,
        },
      });

      const planId = (plan as any).id;
      console.log(`✅ Razorpay plan created: ${planId}\n`);
      return planId;
    } catch (error: any) {
      const errorMsg = error?.error?.description || error?.message || 'Unknown Razorpay error';
      console.error(`\n❌ Razorpay plan creation FAILED for "${params.name}":`);
      console.error(`   Error: ${errorMsg}`);
      console.error(`   Full error:`, JSON.stringify(error?.error || error, null, 2), '\n');
      throw new AppError(`Failed to create Razorpay plan: ${errorMsg}`, 502);
    }
  }

  /**
   * Create a Razorpay subscription for a user (recurring billing).
   *
   * Razorpay API: POST /v1/subscriptions
   * Required: plan_id, total_count
   */
  static async createSubscription(params: {
    planId: string;       // Razorpay plan ID
    billingCycle: BillingCycleType;
    customerEmail: string;
    customerName: string;
    customerPhone?: string;
    trialDays?: number;
  }) {
    const totalCount = getDefaultTotalCount(params.billingCycle);

    console.log(`\n📋 Creating Razorpay subscription:`);
    console.log(`   Plan ID: ${params.planId}`);
    console.log(`   Billing: ${params.billingCycle}, Total cycles: ${totalCount}`);
    console.log(`   Customer: ${params.customerEmail}`);
    if (params.trialDays) console.log(`   Trial: ${params.trialDays} days`);

    try {
      const razorpay = getRazorpayClient();

      const subscriptionData: any = {
        plan_id: params.planId,
        total_count: totalCount,
        quantity: 1,
        customer_notify: true,
        notes: {
          customer_email: params.customerEmail,
          customer_name: params.customerName,
        },
      };

      // Add trial period if specified
      if (params.trialDays && params.trialDays > 0) {
        subscriptionData.start_at = Math.floor(
          (Date.now() + params.trialDays * 24 * 60 * 60 * 1000) / 1000
        );
      }

      const subscription = await razorpay.subscriptions.create(subscriptionData);

      console.log(`✅ Razorpay subscription created: ${subscription.id}`);
      console.log(`   Short URL: ${subscription.short_url}\n`);

      return {
        subscriptionId: subscription.id,
        shortUrl: subscription.short_url,
        status: subscription.status,
      };
    } catch (error: any) {
      const errorMsg = error?.error?.description || error?.message || 'Unknown Razorpay error';
      console.error(`\n❌ Razorpay subscription creation FAILED:`);
      console.error(`   Error: ${errorMsg}`);
      console.error(`   Full error:`, JSON.stringify(error?.error || error, null, 2), '\n');
      throw new AppError(`Failed to create subscription: ${errorMsg}`, 502);
    }
  }

  /**
   * Create a Razorpay order for one-time payment
   */
  static async createOrder(params: {
    amount: number;       // in paise
    currency: string;
    description: string;
    notes?: Record<string, string>;
  }) {
    try {
      const razorpay = getRazorpayClient();
      const order = await razorpay.orders.create({
        amount: params.amount,
        currency: params.currency,
        notes: params.notes || {},
      });
      return {
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
      };
    } catch (error: any) {
      console.error('Razorpay order creation failed:', error?.error?.description || error.message);
      throw new AppError(`Failed to create order: ${error?.error?.description || error.message}`, 502);
    }
  }

  /**
   * Cancel a Razorpay subscription
   */
  static async cancelSubscription(subscriptionId: string, cancelAtCycleEnd = true) {
    try {
      const razorpay = getRazorpayClient();
      const result = await razorpay.subscriptions.cancel(subscriptionId, cancelAtCycleEnd);
      return result;
    } catch (error: any) {
      console.error('Razorpay subscription cancellation failed:', error?.error?.description || error.message);
      throw new AppError(`Failed to cancel subscription: ${error?.error?.description || error.message}`, 502);
    }
  }

  /**
   * Fetch a Razorpay subscription
   */
  static async fetchSubscription(subscriptionId: string) {
    try {
      const razorpay = getRazorpayClient();
      return await razorpay.subscriptions.fetch(subscriptionId);
    } catch (error: any) {
      throw new AppError(`Failed to fetch subscription: ${error?.error?.description || error.message}`, 502);
    }
  }

  /**
   * Fetch a Razorpay payment
   */
  static async fetchPayment(paymentId: string) {
    try {
      const razorpay = getRazorpayClient();
      return await razorpay.payments.fetch(paymentId);
    } catch (error: any) {
      throw new AppError(`Failed to fetch payment: ${error?.error?.description || error.message}`, 502);
    }
  }

  /**
   * Verify payment signature for both subscription and order payments.
   * Always uses RAZORPAY_KEY_SECRET (not webhook secret — they serve different purposes).
   * Uses constant-time comparison to prevent timing attacks.
   */
  static verifyPaymentSignature(params: {
    orderId?: string;
    subscriptionId?: string;
    paymentId: string;
    signature: string;
  }): boolean {
    const secret = env.RAZORPAY_KEY_SECRET;
    let body: string;

    if (params.subscriptionId) {
      body = `${params.paymentId}|${params.subscriptionId}`;
    } else if (params.orderId) {
      body = `${params.orderId}|${params.paymentId}`;
    } else {
      return false;
    }

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(body)
      .digest('hex');

    // Constant-time comparison to prevent timing attacks
    try {
      return crypto.timingSafeEqual(
        Buffer.from(expectedSignature),
        Buffer.from(params.signature)
      );
    } catch {
      // timingSafeEqual throws if buffer lengths differ — that means signatures don't match
      return false;
    }
  }
}
