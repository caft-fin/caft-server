// ─────────────────────────────────────────────────────────
// CAFT Financial — Plan Service (Full CRUD + Razorpay Sync)
// ─────────────────────────────────────────────────────────

import { prisma } from '../config/database';
import { CreatePlanInput, UpdatePlanInput } from '../types';
import { AppError } from '../utils/apiResponse';
import { RazorpayService } from './razorpay.service';
import { CacheService, CACHE_KEYS, CACHE_TTL } from './cache.service';

export class PlanService {
  /**
   * Get all active plans (public, cached)
   */
  static async getActivePlans() {
    return CacheService.getOrSet(CACHE_KEYS.ACTIVE_PLANS, CACHE_TTL.PLANS, async () => {
      return prisma.plan.findMany({
        where: { isActive: true },
        include: { features: true },
        orderBy: { sortOrder: 'asc' },
      });
    });
  }

  /**
   * Get all plans including inactive (admin)
   */
  static async getAllPlans() {
    return prisma.plan.findMany({
      include: { features: true, _count: { select: { subscriptions: true } } },
      orderBy: { sortOrder: 'asc' },
    });
  }

  /**
   * Get a single plan by ID
   */
  static async getPlanById(id: string) {
    const plan = await prisma.plan.findUnique({
      where: { id },
      include: { features: true, _count: { select: { subscriptions: true } } },
    });
    if (!plan) throw new AppError('Plan not found', 404);
    return plan;
  }

  /**
   * Create a new plan + sync to Razorpay
   */
  static async createPlan(input: CreatePlanInput) {
    // Check slug uniqueness
    const existing = await prisma.plan.findUnique({ where: { slug: input.slug } });
    if (existing) throw new AppError('A plan with this slug already exists', 409);

    // Create Razorpay plans (monthly and yearly)
    let razorpayPlanIdMonthly: string | null = null;
    let razorpayPlanIdYearly: string | null = null;

    if (input.priceMonthly > 0) {
      razorpayPlanIdMonthly = await RazorpayService.createPlan({
        name: `${input.name} - Monthly`,
        amount: input.priceMonthly,
        currency: input.currency || 'INR',
        period: 'monthly',
        description: input.description,
      });
    }

    if (input.priceYearly > 0) {
      razorpayPlanIdYearly = await RazorpayService.createPlan({
        name: `${input.name} - Yearly`,
        amount: input.priceYearly,
        currency: input.currency || 'INR',
        period: 'yearly',
        description: input.description,
      });
    }

    // Create plan in database
    const plan = await prisma.plan.create({
      data: {
        name: input.name,
        slug: input.slug,
        description: input.description,
        priceMonthly: input.priceMonthly,
        priceYearly: input.priceYearly,
        currency: input.currency || 'INR',
        razorpayPlanIdMonthly,
        razorpayPlanIdYearly,
        isPopular: input.isPopular || false,
        trialPeriodDays: input.trialPeriodDays,
        sortOrder: input.sortOrder || 0,
        features: {
          create: input.features.map((f) => ({
            name: f.name,
            included: f.included,
            value: f.value,
          })),
        },
      },
      include: { features: true },
    });

    // Invalidate cache
    await CacheService.del(CACHE_KEYS.ACTIVE_PLANS);

    return plan;
  }

  /**
   * Update an existing plan (name, description, pricing, features, etc.)
   */
  static async updatePlan(id: string, input: UpdatePlanInput) {
    const existing = await prisma.plan.findUnique({ where: { id } });
    if (!existing) throw new AppError('Plan not found', 404);

    // If pricing changed, create new Razorpay plans (they're immutable)
    let razorpayUpdates: Record<string, string | null> = {};

    if (input.priceMonthly !== undefined && input.priceMonthly !== existing.priceMonthly) {
      if (input.priceMonthly > 0) {
        razorpayUpdates.razorpayPlanIdMonthly = await RazorpayService.createPlan({
          name: `${input.name || existing.name} - Monthly`,
          amount: input.priceMonthly,
          currency: existing.currency,
          period: 'monthly',
        });
      } else {
        razorpayUpdates.razorpayPlanIdMonthly = null;
      }
    }

    if (input.priceYearly !== undefined && input.priceYearly !== existing.priceYearly) {
      if (input.priceYearly > 0) {
        razorpayUpdates.razorpayPlanIdYearly = await RazorpayService.createPlan({
          name: `${input.name || existing.name} - Yearly`,
          amount: input.priceYearly,
          currency: existing.currency,
          period: 'yearly',
        });
      } else {
        razorpayUpdates.razorpayPlanIdYearly = null;
      }
    }

    // Handle features update
    if (input.features) {
      // Delete old features and recreate
      await prisma.planFeature.deleteMany({ where: { planId: id } });
      await prisma.planFeature.createMany({
        data: input.features.map((f) => ({
          planId: id,
          name: f.name,
          included: f.included,
          value: f.value,
        })),
      });
    }

    // Update plan
    const plan = await prisma.plan.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.priceMonthly !== undefined && { priceMonthly: input.priceMonthly }),
        ...(input.priceYearly !== undefined && { priceYearly: input.priceYearly }),
        ...(input.isPopular !== undefined && { isPopular: input.isPopular }),
        ...(input.isActive !== undefined && { isActive: input.isActive }),
        ...(input.trialPeriodDays !== undefined && { trialPeriodDays: input.trialPeriodDays }),
        ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
        ...razorpayUpdates,
      },
      include: { features: true },
    });

    // Invalidate caches
    await CacheService.del(CACHE_KEYS.ACTIVE_PLANS);
    await CacheService.del(CACHE_KEYS.PLAN(id));

    return plan;
  }

  /**
   * Update pricing only
   */
  static async updatePricing(id: string, priceMonthly?: number, priceYearly?: number) {
    return PlanService.updatePlan(id, { priceMonthly, priceYearly });
  }

  /**
   * Update features only
   */
  static async updateFeatures(id: string, features: UpdatePlanInput['features']) {
    return PlanService.updatePlan(id, { features });
  }

  /**
   * Soft-delete a plan (mark as inactive)
   */
  static async deletePlan(id: string) {
    const plan = await prisma.plan.findUnique({
      where: { id },
      include: { _count: { select: { subscriptions: { where: { status: 'ACTIVE' } } } } },
    });

    if (!plan) throw new AppError('Plan not found', 404);

    if (plan._count.subscriptions > 0) {
      // Soft delete — don't remove plans with active subscribers
      await prisma.plan.update({ where: { id }, data: { isActive: false } });
    } else {
      // Hard delete if no active subscriptions
      await prisma.planFeature.deleteMany({ where: { planId: id } });
      await prisma.plan.delete({ where: { id } });
    }

    // Invalidate cache
    await CacheService.del(CACHE_KEYS.ACTIVE_PLANS);
    await CacheService.del(CACHE_KEYS.PLAN(id));

    return { message: 'Plan deleted successfully' };
  }
}
