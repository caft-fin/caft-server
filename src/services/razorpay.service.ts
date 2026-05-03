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
 * Razorpay supports: daily, weekly, monthly, yearly
 * We use interval multipliers for bi-weekly, quarterly, half-yearly.
 */
function mapBillingCycleToRazorpay(cycle: BillingCycleType): { period: string; interval: number } {
  switch (cycle) {
    case 'DAILY':      return { period: 'daily', interval: 1 };
    case 'WEEKLY':     return { period: 'weekly', interval: 1 };
    case 'BIWEEKLY':   return { period: 'daily', interval: 15 };
    case 'MONTHLY':    return { period: 'monthly', interval: 1 };
    case 'QUARTERLY':  return { period: 'monthly', interval: 3 };
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
    case 'DAILY':      return 365;  // 1 year of daily billing
    case 'WEEKLY':     return 52;   // 1 year of weekly billing
    case 'BIWEEKLY':   return 24;   // 1 year of bi-weekly billing
    case 'MONTHLY':    return 12;   // 1 year of monthly billing
    case 'QUARTERLY':  return 4;    // 1 year of quarterly billing
    case 'HALFYEARLY': return 2;    // 1 year of half-yearly billing
    case 'ANNUALLY':   return 1;    // 1 year
    default:           return 12;
  }
}

export class RazorpayService {
  /**
   * Create a Razorpay plan (plans are immutable in Razorpay)
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

    try {
      const razorpay = getRazorpayClient();
      const { period, interval } = mapBillingCycleToRazorpay(params.billingCycle);

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
      return (plan as any).id;
    } catch (error: any) {
      console.error('Razorpay plan creation failed:', error?.error?.description || error.message);
      throw new AppError(`Failed to create Razorpay plan: ${error?.error?.description || error.message}`, 502);
    }
  }

  /**
   * Create a Razorpay subscription for a user (recurring billing)
   */
  static async createSubscription(params: {
    planId: string;       // Razorpay plan ID
    billingCycle: BillingCycleType;
    customerEmail: string;
    customerName: string;
    customerPhone?: string;
    trialDays?: number;
  }) {
    try {
      const razorpay = getRazorpayClient();
      const totalCount = getDefaultTotalCount(params.billingCycle);

      const subscriptionData: any = {
        plan_id: params.planId,
        total_count: totalCount,
        quantity: 1,
        customer_notify: 1,
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
      return {
        subscriptionId: subscription.id,
        shortUrl: subscription.short_url,
        status: subscription.status,
      };
    } catch (error: any) {
      console.error('Razorpay subscription creation failed:', error?.error?.description || error.message);
      throw new AppError(`Failed to create subscription: ${error?.error?.description || error.message}`, 502);
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
   * Verify payment signature for both subscription and order payments
   */
  static verifyPaymentSignature(params: {
    orderId?: string;
    subscriptionId?: string;
    paymentId: string;
    signature: string;
  }): boolean {
    const secret = env.RAZORPAY_WEBHOOK_SECRET || env.RAZORPAY_KEY_SECRET;
    let expectedSignature: string;

    if (params.subscriptionId) {
      expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(`${params.paymentId}|${params.subscriptionId}`)
        .digest('hex');
    } else if (params.orderId) {
      expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(`${params.orderId}|${params.paymentId}`)
        .digest('hex');
    } else {
      return false;
    }

    return expectedSignature === params.signature;
  }
}
