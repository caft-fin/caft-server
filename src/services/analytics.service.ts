// ─────────────────────────────────────────────────────────
// CAFT Financial — Subscription Analytics Service
// ─────────────────────────────────────────────────────────

import { prisma } from '../config/database';
import { CacheService, CACHE_TTL } from './cache.service';

type PeriodFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

export class AnalyticsService {
  /**
   * Get comprehensive subscription overview
   */
  static async getSubscriptionOverview() {
    const [
      totalSubscribers,
      activeSubscriptions,
      trialSubscriptions,
      cancelledSubscriptions,
      expiredSubscriptions,
      haltedSubscriptions,
      createdSubscriptions,
    ] = await Promise.all([
      prisma.subscription.count(),
      prisma.subscription.count({ where: { status: 'ACTIVE' } }),
      prisma.subscription.count({ where: { trialEndsAt: { gt: new Date() }, status: 'ACTIVE' } }),
      prisma.subscription.count({ where: { status: 'CANCELLED' } }),
      prisma.subscription.count({ where: { status: 'EXPIRED' } }),
      prisma.subscription.count({ where: { status: 'HALTED' } }),
      prisma.subscription.count({ where: { status: 'CREATED' } }),
    ]);

    // Per-plan breakdown
    const perPlan = await prisma.subscription.groupBy({
      by: ['planId'],
      where: { status: 'ACTIVE' },
      _count: true,
    });

    // Fetch plan names
    const planIds = perPlan.map(p => p.planId);
    const plans = await prisma.plan.findMany({
      where: { id: { in: planIds } },
      select: { id: true, name: true },
    });
    const planMap = new Map(plans.map(p => [p.id, p.name]));

    const perPlanBreakdown = perPlan.map(p => ({
      planId: p.planId,
      planName: planMap.get(p.planId) || 'Unknown',
      activeSubscribers: p._count,
    }));

    // Billing cycle breakdown
    const perCycle = await prisma.subscription.groupBy({
      by: ['billingCycle'],
      where: { status: 'ACTIVE' },
      _count: true,
    });

    return {
      totalSubscribers,
      activeSubscriptions,
      trialSubscriptions,
      cancelledSubscriptions,
      expiredSubscriptions,
      haltedSubscriptions,
      pendingSubscriptions: createdSubscriptions,
      perPlanBreakdown,
      perCycleBreakdown: perCycle.map(c => ({
        billingCycle: c.billingCycle,
        count: c._count,
      })),
    };
  }

  /**
   * Get revenue analytics
   */
  static async getRevenueAnalytics() {
    // Total revenue
    const totalRevenue = await prisma.payment.aggregate({
      where: { status: 'CAPTURED' },
      _sum: { amount: true },
      _count: true,
    });

    // Revenue by plan
    const revenueByPlanRaw = await prisma.payment.findMany({
      where: { status: 'CAPTURED', subscriptionId: { not: null } },
      include: {
        subscription: { include: { plan: { select: { id: true, name: true } } } },
      },
    });

    const revenueByPlan: Record<string, { planId: string; planName: string; revenue: number; count: number }> = {};
    for (const payment of revenueByPlanRaw) {
      const planId = payment.subscription?.plan?.id || 'unknown';
      const planName = payment.subscription?.plan?.name || 'Unknown';
      if (!revenueByPlan[planId]) {
        revenueByPlan[planId] = { planId, planName, revenue: 0, count: 0 };
      }
      revenueByPlan[planId].revenue += payment.amount;
      revenueByPlan[planId].count += 1;
    }

    // MRR calculation (sum of monthly-equivalent revenue from active subscriptions)
    const activeSubscriptions = await prisma.subscription.findMany({
      where: { status: 'ACTIVE', isOneTime: false },
      include: {
        plan: { include: { pricing: true } },
      },
    });

    let mrr = 0;
    for (const sub of activeSubscriptions) {
      const pricing = sub.plan.pricing.find(p => p.billingCycle === sub.billingCycle);
      if (!pricing) continue;

      const monthlyEquivalent = getMonthlyEquivalent(sub.billingCycle, pricing.price);
      if (sub.discountApplied && sub.discountApplied > 0) {
        mrr += Math.round(monthlyEquivalent * (1 - sub.discountApplied / 100));
      } else {
        mrr += monthlyEquivalent;
      }
    }

    const arr = mrr * 12;

    // Revenue over last 12 months
    const monthlyRevenue = await getRevenueByPeriod('monthly', 12);

    return {
      totalRevenue: totalRevenue._sum.amount || 0,
      totalPayments: totalRevenue._count || 0,
      mrr,
      arr,
      revenueByPlan: Object.values(revenueByPlan),
      monthlyRevenue,
    };
  }

  /**
   * Get churn analytics
   */
  static async getChurnAnalytics() {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    const [
      totalCancelled,
      cancelledLast30,
      cancelledLast90,
      totalActiveStart30,
      failedPayments,
      haltedSubscriptions,
    ] = await Promise.all([
      prisma.subscription.count({ where: { status: 'CANCELLED' } }),
      prisma.subscription.count({ where: { status: 'CANCELLED', cancelledAt: { gte: thirtyDaysAgo } } }),
      prisma.subscription.count({ where: { status: 'CANCELLED', cancelledAt: { gte: ninetyDaysAgo } } }),
      prisma.subscription.count({ where: { createdAt: { lte: thirtyDaysAgo }, status: { in: ['ACTIVE', 'CANCELLED', 'EXPIRED'] } } }),
      prisma.payment.count({ where: { status: 'FAILED' } }),
      prisma.subscription.count({ where: { status: 'HALTED' } }),
    ]);

    // Churn rate = cancellations in period / active at start of period
    const churnRate30 = totalActiveStart30 > 0 ? (cancelledLast30 / totalActiveStart30) * 100 : 0;

    // Cancel reasons breakdown
    const cancelReasons = await prisma.subscription.groupBy({
      by: ['cancelReason'],
      where: { status: 'CANCELLED', cancelReason: { not: null } },
      _count: true,
      orderBy: { _count: { cancelReason: 'desc' } },
      take: 10,
    });

    // Recent cancellations
    const recentCancellations = await prisma.subscription.findMany({
      where: { status: 'CANCELLED' },
      include: {
        user: { select: { id: true, name: true, email: true } },
        plan: { select: { id: true, name: true } },
      },
      orderBy: { cancelledAt: 'desc' },
      take: 20,
    });

    return {
      totalCancelled,
      cancelledLast30Days: cancelledLast30,
      cancelledLast90Days: cancelledLast90,
      churnRate30Day: Math.round(churnRate30 * 100) / 100,
      failedPayments,
      haltedSubscriptions,
      cancelReasons: cancelReasons.map(r => ({
        reason: r.cancelReason || 'Not specified',
        count: r._count,
      })),
      recentCancellations: recentCancellations.map(s => ({
        id: s.id,
        userName: s.user.name,
        userEmail: s.user.email,
        planName: s.plan.name,
        cancelledAt: s.cancelledAt,
        cancelReason: s.cancelReason,
      })),
    };
  }

  /**
   * Get growth analytics
   */
  static async getGrowthAnalytics() {
    const now = new Date();

    // Subscriptions created per month (last 12 months)
    const newSubscriptionsMonthly: { month: string; count: number }[] = [];
    const cancellationsMonthly: { month: string; count: number }[] = [];

    for (let i = 11; i >= 0; i--) {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);

      const [newSubs, cancelled] = await Promise.all([
        prisma.subscription.count({
          where: { createdAt: { gte: startOfMonth, lte: endOfMonth } },
        }),
        prisma.subscription.count({
          where: { cancelledAt: { gte: startOfMonth, lte: endOfMonth } },
        }),
      ]);

      const monthLabel = startOfMonth.toLocaleString('default', { month: 'short', year: '2-digit' });
      newSubscriptionsMonthly.push({ month: monthLabel, count: newSubs });
      cancellationsMonthly.push({ month: monthLabel, count: cancelled });
    }

    // Trial conversion rate
    const totalTrials = await prisma.subscription.count({
      where: { trialEndsAt: { not: null } },
    });
    const convertedTrials = await prisma.subscription.count({
      where: {
        trialEndsAt: { not: null, lt: now },
        status: 'ACTIVE',
      },
    });
    const trialConversionRate = totalTrials > 0 ? (convertedTrials / totalTrials) * 100 : 0;

    // Failed/abandoned subscriptions (CREATED status older than 24 hours)
    const abandonedSubscriptions = await prisma.subscription.count({
      where: {
        status: 'CREATED',
        createdAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
      },
    });

    // One-time vs recurring breakdown
    const [oneTimeCount, recurringCount] = await Promise.all([
      prisma.subscription.count({ where: { isOneTime: true, status: 'ACTIVE' } }),
      prisma.subscription.count({ where: { isOneTime: false, status: 'ACTIVE' } }),
    ]);

    return {
      newSubscriptionsMonthly,
      cancellationsMonthly,
      trialConversionRate: Math.round(trialConversionRate * 100) / 100,
      totalTrials,
      convertedTrials,
      abandonedSubscriptions,
      typeBreakdown: {
        oneTime: oneTimeCount,
        recurring: recurringCount,
      },
    };
  }

  /**
   * Get subscription rate at various frequencies
   */
  static async getSubscriptionRates() {
    const now = new Date();
    const periods = [
      { label: 'Today', start: new Date(now.getFullYear(), now.getMonth(), now.getDate()) },
      { label: 'This Week', start: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) },
      { label: 'Bi-weekly', start: new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000) },
      { label: 'This Month', start: new Date(now.getFullYear(), now.getMonth(), 1) },
      { label: 'This Quarter', start: new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1) },
      { label: 'This Half', start: new Date(now.getFullYear(), now.getMonth() < 6 ? 0 : 6, 1) },
      { label: 'This Year', start: new Date(now.getFullYear(), 0, 1) },
    ];

    const rates = await Promise.all(
      periods.map(async (period) => {
        const [newSubs, cancelled] = await Promise.all([
          prisma.subscription.count({ where: { createdAt: { gte: period.start } } }),
          prisma.subscription.count({ where: { cancelledAt: { gte: period.start } } }),
        ]);
        return {
          period: period.label,
          newSubscriptions: newSubs,
          cancellations: cancelled,
          netGrowth: newSubs - cancelled,
        };
      })
    );

    return rates;
  }
}

// ── Helpers ──────────────────────────────────────────────

/**
 * Convert any billing cycle's price to monthly equivalent
 */
function getMonthlyEquivalent(cycle: string, price: number): number {
  switch (cycle) {
    case 'DAILY':      return price * 30;
    case 'WEEKLY':     return price * 4.33;
    case 'BIWEEKLY':   return price * 2;
    case 'MONTHLY':    return price;
    case 'QUARTERLY':  return price / 3;
    case 'HALFYEARLY': return price / 6;
    case 'ANNUALLY':   return price / 12;
    default:           return price;
  }
}

/**
 * Get revenue grouped by time period
 */
async function getRevenueByPeriod(frequency: PeriodFrequency, count: number) {
  const now = new Date();
  const results: { period: string; revenue: number; count: number }[] = [];

  for (let i = count - 1; i >= 0; i--) {
    let start: Date;
    let end: Date;
    let label: string;

    switch (frequency) {
      case 'daily':
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i + 1);
        label = start.toLocaleDateString('default', { month: 'short', day: 'numeric' });
        break;
      case 'weekly':
        start = new Date(now.getTime() - (i + 1) * 7 * 24 * 60 * 60 * 1000);
        end = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000);
        label = `W${count - i}`;
        break;
      case 'monthly':
        start = new Date(now.getFullYear(), now.getMonth() - i, 1);
        end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
        label = start.toLocaleString('default', { month: 'short', year: '2-digit' });
        break;
      case 'quarterly':
        start = new Date(now.getFullYear(), now.getMonth() - i * 3, 1);
        end = new Date(now.getFullYear(), now.getMonth() - (i - 1) * 3, 0, 23, 59, 59);
        label = `Q${Math.ceil((start.getMonth() + 1) / 3)} ${start.getFullYear()}`;
        break;
      case 'yearly':
        start = new Date(now.getFullYear() - i, 0, 1);
        end = new Date(now.getFullYear() - i, 11, 31, 23, 59, 59);
        label = `${start.getFullYear()}`;
        break;
      default:
        start = new Date(now.getFullYear(), now.getMonth() - i, 1);
        end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
        label = start.toLocaleString('default', { month: 'short' });
    }

    const agg = await prisma.payment.aggregate({
      where: {
        status: 'CAPTURED',
        createdAt: { gte: start, lte: end },
      },
      _sum: { amount: true },
      _count: true,
    });

    results.push({
      period: label,
      revenue: agg._sum.amount || 0,
      count: agg._count || 0,
    });
  }

  return results;
}
