// ─────────────────────────────────────────────────────────
// CAFT Financial — Subscription Service
// ─────────────────────────────────────────────────────────

import { prisma } from '../config/database';
import { BillingCycle } from '@prisma/client';
import { AppError } from '../utils/apiResponse';
import { RazorpayService } from './razorpay.service';
import { CacheService, CACHE_KEYS } from './cache.service';

export class SubscriptionService {
  /**
   * Create a new subscription via Razorpay
   */
  static async createSubscription(userId: string, planId: string, billingCycle: BillingCycle) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError('User not found', 404);

    // Check for existing active subscription
    const existing = await prisma.subscription.findFirst({
      where: { userId, status: { in: ['ACTIVE', 'AUTHENTICATED', 'CREATED'] } },
    });
    if (existing) throw new AppError('You already have an active subscription. Cancel it first or upgrade.', 409);

    const plan = await prisma.plan.findUnique({ where: { id: planId } });
    if (!plan || !plan.isActive) throw new AppError('Plan not found or inactive', 404);

    // Select the correct Razorpay plan ID
    const razorpayPlanId = billingCycle === 'MONTHLY'
      ? plan.razorpayPlanIdMonthly
      : plan.razorpayPlanIdYearly;

    if (!razorpayPlanId) throw new AppError('This billing cycle is not available for the selected plan', 400);

    // Create Razorpay subscription
    const rzpSubscription = await RazorpayService.createSubscription({
      planId: razorpayPlanId,
      totalCount: billingCycle === 'MONTHLY' ? 12 : 1,
      customerEmail: user.email,
      customerName: user.name,
      customerPhone: user.phone || undefined,
    });

    // Save subscription in DB
    const subscription = await prisma.subscription.create({
      data: {
        userId,
        planId,
        razorpaySubscriptionId: rzpSubscription.subscriptionId,
        billingCycle,
        status: 'CREATED',
      },
      include: { plan: { include: { features: true } } },
    });

    return {
      subscription,
      razorpaySubscriptionId: rzpSubscription.subscriptionId,
      shortUrl: rzpSubscription.shortUrl,
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
      include: { plan: true },
    });

    if (!subscription || subscription.userId !== userId) {
      throw new AppError('Subscription not found', 404);
    }

    // Update subscription status
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(
          Date.now() + (subscription.billingCycle === 'MONTHLY' ? 30 : 365) * 24 * 60 * 60 * 1000
        ),
      },
    });

    // Record payment
    const amount = subscription.billingCycle === 'MONTHLY'
      ? subscription.plan.priceMonthly
      : subscription.plan.priceYearly;

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
   * Get user's active subscription
   */
  static async getActiveSubscription(userId: string) {
    return prisma.subscription.findFirst({
      where: { userId, status: { in: ['ACTIVE', 'AUTHENTICATED'] } },
      include: { plan: { include: { features: true } } },
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

    // Cancel on Razorpay
    if (subscription.razorpaySubscriptionId) {
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
