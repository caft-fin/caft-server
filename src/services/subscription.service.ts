// ─────────────────────────────────────────────────────────
// CAFT Financial — Subscription Service
// ─────────────────────────────────────────────────────────

import { prisma } from '../config/database';
import { BillingCycle } from '@prisma/client';
import { AppError } from '../utils/apiResponse';
import { RazorpayService } from './razorpay.service';
import { CacheService, CACHE_KEYS } from './cache.service';
import { BillingCycleType } from '../types';

/**
 * Returns the period length in milliseconds for a billing cycle
 */
function getCycleDurationMs(cycle: BillingCycleType): number {
  const DAY = 24 * 60 * 60 * 1000;
  switch (cycle) {
    case 'DAILY':      return 1 * DAY;
    case 'WEEKLY':     return 7 * DAY;
    case 'BIWEEKLY':   return 15 * DAY;
    case 'MONTHLY':    return 30 * DAY;
    case 'QUARTERLY':  return 90 * DAY;
    case 'HALFYEARLY': return 180 * DAY;
    case 'ANNUALLY':   return 365 * DAY;
    case 'ONETIME':    return 0; // Lifetime
    default:           return 30 * DAY;
  }
}

export class SubscriptionService {
  /**
   * Create a new recurring subscription via Razorpay
   */
  static async createSubscription(userId: string, planId: string, billingCycle: BillingCycle) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError('User not found', 404);

    // Check for existing active subscription
    const existing = await prisma.subscription.findFirst({
      where: { userId, status: { in: ['ACTIVE', 'AUTHENTICATED', 'CREATED'] } },
    });
    if (existing) throw new AppError('You already have an active subscription. Cancel it first or upgrade.', 409);

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(planId);
    const plan = await prisma.plan.findFirst({
      where: isUuid ? { id: planId } : { slug: planId },
      include: { pricing: true },
    });
    if (!plan || !plan.isActive) throw new AppError('Plan not found or inactive', 404);

    // Handle FREE plans
    if (plan.planType === 'FREE') {
      const subscription = await prisma.subscription.create({
        data: {
          userId,
          planId,
          billingCycle,
          status: 'ACTIVE',
          currentPeriodStart: new Date(),
          currentPeriodEnd: null, // No end for free plans
        },
        include: { plan: { include: { features: true, pricing: true } } },
      });
      return { subscription, razorpaySubscriptionId: null, shortUrl: null };
    }

    // Handle ONE-TIME purchase
    if (plan.isOneTime && billingCycle === 'ONETIME') {
      return SubscriptionService.createOneTimeSubscription(userId, plan);
    }

    // Find the pricing for the selected billing cycle
    const pricing = plan.pricing.find(p => p.billingCycle === billingCycle && p.isActive);
    if (!pricing) throw new AppError(`This billing cycle (${billingCycle}) is not available for the selected plan`, 400);

    // Need a Razorpay plan ID
    if (!pricing.razorpayPlanId) throw new AppError('Razorpay plan not configured for this duration', 400);

    // Apply discount if any
    let finalAmount = pricing.price;
    if (plan.discountPercent && plan.discountPercent > 0) {
      finalAmount = Math.round(pricing.price * (1 - plan.discountPercent / 100));
    }

    // Create Razorpay subscription
    const rzpSubscription = await RazorpayService.createSubscription({
      planId: pricing.razorpayPlanId,
      billingCycle: billingCycle as BillingCycleType,
      customerEmail: user.email,
      customerName: user.name,
      customerPhone: user.phone || undefined,
      trialDays: plan.freeTrialEnabled ? (plan.freeTrialDays || 0) : 0,
    });

    // Save subscription in DB
    const subscription = await prisma.subscription.create({
      data: {
        userId,
        planId,
        razorpaySubscriptionId: rzpSubscription.subscriptionId,
        billingCycle,
        status: 'CREATED',
        discountApplied: plan.discountPercent,
        trialEndsAt: plan.freeTrialEnabled && plan.freeTrialDays
          ? new Date(Date.now() + plan.freeTrialDays * 24 * 60 * 60 * 1000)
          : null,
      },
      include: { plan: { include: { features: true, pricing: true } } },
    });

    return {
      subscription,
      razorpaySubscriptionId: rzpSubscription.subscriptionId,
      shortUrl: rzpSubscription.shortUrl,
    };
  }

  /**
   * Create a one-time purchase (lifetime subscription)
   */
  static async createOneTimeSubscription(userId: string, plan: any) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError('User not found', 404);

    if (!plan.oneTimePrice || plan.oneTimePrice <= 0) {
      throw new AppError('One-time price not configured for this plan', 400);
    }

    // Apply discount
    let finalAmount = plan.oneTimePrice;
    if (plan.discountPercent && plan.discountPercent > 0) {
      finalAmount = Math.round(plan.oneTimePrice * (1 - plan.discountPercent / 100));
    }

    // Create Razorpay order (not subscription)
    const order = await RazorpayService.createOrder({
      amount: finalAmount,
      currency: plan.currency || 'INR',
      description: `One-time purchase: ${plan.name}`,
      notes: {
        plan_id: plan.id,
        user_id: userId,
        type: 'one_time',
      },
    });

    // Save subscription in DB
    const subscription = await prisma.subscription.create({
      data: {
        userId,
        planId: plan.id,
        billingCycle: 'ONETIME',
        status: 'CREATED',
        isOneTime: true,
        discountApplied: plan.discountPercent,
      },
      include: { plan: { include: { features: true, pricing: true } } },
    });

    return {
      subscription,
      subscriptionId: subscription.id,
      orderId: order.orderId,
      amount: order.amount,
      currency: order.currency,
    };
  }

  /**
   * Verify a subscription payment (after Razorpay checkout)
   */
  static async verifyPayment(
    userId: string,
    razorpayPaymentId: string,
    razorpaySubscriptionId: string,
    razorpaySignature: string
  ) {
    const subscription = await prisma.subscription.findUnique({
      where: { razorpaySubscriptionId },
      include: { plan: { include: { pricing: true } } },
    });

    if (!subscription || subscription.userId !== userId) {
      throw new AppError('Subscription not found', 404);
    }

    // Find the pricing for this subscription's billing cycle
    const pricing = subscription.plan.pricing.find(
      p => p.billingCycle === subscription.billingCycle
    );
    const amount = pricing?.price || 0;

    const cycleDuration = getCycleDurationMs(subscription.billingCycle as BillingCycleType);

    // Update subscription status
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: cycleDuration > 0
          ? new Date(Date.now() + cycleDuration)
          : null,
      },
    });

    // Record payment
    await prisma.payment.create({
      data: {
        userId,
        subscriptionId: subscription.id,
        razorpayPaymentId,
        razorpaySignature,
        amount,
        currency: subscription.plan.currency,
        status: 'CAPTURED',
        description: `${subscription.plan.name} - ${subscription.billingCycle} subscription`,
      },
    });

    // Invalidate cache
    await CacheService.del(CACHE_KEYS.USER_SUBSCRIPTION(userId));

    return { message: 'Payment verified and subscription activated' };
  }

  /**
   * Verify a one-time payment (after Razorpay checkout)
   */
  static async verifyOneTimePayment(
    userId: string,
    razorpayPaymentId: string,
    razorpayOrderId: string,
    razorpaySignature: string,
    subscriptionId: string
  ) {
    const subscription = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: { plan: true },
    });

    if (!subscription || subscription.userId !== userId || !subscription.isOneTime) {
      throw new AppError('Subscription not found', 404);
    }

    // Activate the lifetime subscription
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: null, // No end — lifetime
      },
    });

    // Record payment
    await prisma.payment.create({
      data: {
        userId,
        subscriptionId: subscription.id,
        razorpayPaymentId,
        razorpayOrderId,
        razorpaySignature,
        amount: subscription.plan.oneTimePrice || 0,
        currency: subscription.plan.currency,
        status: 'CAPTURED',
        description: `${subscription.plan.name} - Lifetime Purchase`,
      },
    });

    await CacheService.del(CACHE_KEYS.USER_SUBSCRIPTION(userId));

    return { message: 'Payment verified and lifetime access activated' };
  }

  /**
   * Get user's active subscription
   */
  static async getActiveSubscription(userId: string) {
    return prisma.subscription.findFirst({
      where: { userId, status: { in: ['ACTIVE', 'AUTHENTICATED'] } },
      include: { plan: { include: { features: true, pricing: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Cancel a subscription
   */
  static async cancelSubscription(userId: string, reason?: string) {
    const subscription = await prisma.subscription.findFirst({
      where: { userId, status: { in: ['ACTIVE', 'AUTHENTICATED'] } },
    });

    if (!subscription) throw new AppError('No active subscription found', 404);

    // Cancel on Razorpay (only for recurring subscriptions)
    if (subscription.razorpaySubscriptionId && !subscription.isOneTime) {
      await RazorpayService.cancelSubscription(subscription.razorpaySubscriptionId);
    }

    // Update DB
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason },
    });

    await CacheService.del(CACHE_KEYS.USER_SUBSCRIPTION(userId));

    return { message: 'Subscription cancelled successfully' };
  }

  /**
   * Upgrade subscription to a new plan
   */
  static async upgradeSubscription(userId: string, newPlanId: string, billingCycle: BillingCycle) {
    // Cancel existing
    await SubscriptionService.cancelSubscription(userId, 'Upgraded to new plan').catch(() => {});
    // Create new
    return SubscriptionService.createSubscription(userId, newPlanId, billingCycle);
  }
}
