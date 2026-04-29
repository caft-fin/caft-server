// ─────────────────────────────────────────────────────────
// CAFT Financial — Razorpay Service (Plans & Subscriptions)
// ─────────────────────────────────────────────────────────

import { getRazorpayClient } from '../config/razorpay';
import { env } from '../config/env';
import { AppError } from '../utils/apiResponse';

export class RazorpayService {
  /**
   * Create a Razorpay plan (plans are immutable in Razorpay)
   */
  static async createPlan(params: {
    name: string;
    amount: number;       // in paise
    currency: string;
    period: 'monthly' | 'yearly';
    description?: string;
  }): Promise<string> {
    try {
      const razorpay = getRazorpayClient();
      const plan = await razorpay.plans.create({
        period: params.period,
        interval: 1,
        item: {
          name: params.name,
          amount: params.amount,
          currency: params.currency,
          description: params.description || params.name,
        },
      });
      return plan.id;
    } catch (error: any) {
      console.error('Razorpay plan creation failed:', error?.error?.description || error.message);
      throw new AppError(`Failed to create Razorpay plan: ${error?.error?.description || error.message}`, 502);
    }
  }

  /**
   * Create a Razorpay subscription for a user
   */
  static async createSubscription(params: {
    planId: string;       // Razorpay plan ID
    totalCount: number;   // Number of billing cycles
    customerEmail: string;
    customerName: string;
    customerPhone?: string;
  }) {
    try {
      const razorpay = getRazorpayClient();
      const subscription = await razorpay.subscriptions.create({
        plan_id: params.planId,
        total_count: params.totalCount,
        quantity: 1,
        customer_notify: 1,
        notes: {
          customer_email: params.customerEmail,
          customer_name: params.customerName,
        },
      });
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
}
