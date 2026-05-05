// ─────────────────────────────────────────────────────────
// CAFT Financial — Plan Service (Full CRUD + Razorpay Sync)
// ─────────────────────────────────────────────────────────

import { prisma } from '../config/database';
import { CreatePlanInput, UpdatePlanInput, CreateBundleInput, UpdateBundleInput, BillingCycleType } from '../types';
import { AppError } from '../utils/apiResponse';
import { RazorpayService } from './razorpay.service';
import { CacheService, CACHE_KEYS, CACHE_TTL } from './cache.service';

export class PlanService {
  // ── Plan CRUD ──────────────────────────────────────────

  /**
   * Get all active plans (public, cached)
   */
  static async getActivePlans() {
    return CacheService.getOrSet(CACHE_KEYS.ACTIVE_PLANS, CACHE_TTL.PLANS, async () => {
      return prisma.plan.findMany({
        where: { isActive: true },
        include: {
          features: { orderBy: { sortOrder: 'asc' } },
          pricing: { where: { isActive: true }, orderBy: { billingCycle: 'asc' } },
        },
        orderBy: { sortOrder: 'asc' },
      });
    });
  }

  /**
   * Get all plans including inactive (admin)
   */
  static async getAllPlans() {
    return prisma.plan.findMany({
      include: {
        features: { orderBy: { sortOrder: 'asc' } },
        pricing: { orderBy: { billingCycle: 'asc' } },
        _count: { select: { subscriptions: true } },
      },
      orderBy: { sortOrder: 'asc' },
    });
  }

  /**
   * Get a single plan by ID
   */
  static async getPlanById(id: string) {
    const plan = await prisma.plan.findUnique({
      where: { id },
      include: {
        features: { orderBy: { sortOrder: 'asc' } },
        pricing: { orderBy: { billingCycle: 'asc' } },
        _count: { select: { subscriptions: true } },
      },
    });
    if (!plan) throw new AppError('Plan not found', 404);
    return plan;
  }

  /**
   * Create a new plan + sync pricing to Razorpay
   */
  static async createPlan(input: CreatePlanInput) {
    // Check slug uniqueness
    const existing = await prisma.plan.findUnique({ where: { slug: input.slug } });
    if (existing) throw new AppError('A plan with this slug already exists', 409);

    // Create plan in database first
    const plan = await prisma.plan.create({
      data: {
        name: input.name,
        slug: input.slug,
        description: input.description,
        planType: input.planType,
        itemCategory: input.itemCategory || 'SUBSCRIPTION',
        currency: input.currency || 'INR',
        bannerBadge: input.bannerBadge,
        images: input.images || [],
        isPopular: input.isPopular || false,
        sortOrder: input.sortOrder || 0,
        stockLimit: input.stockLimit ?? null,
        taxPercentage: input.taxPercentage ?? null,
        isOneTime: input.isOneTime || false,
        oneTimePrice: input.isOneTime ? input.oneTimePrice : null,
        freeTrialEnabled: input.freeTrialEnabled || false,
        freeTrialDays: input.freeTrialEnabled ? input.freeTrialDays : null,
        discountPercent: input.discountPercent,
        discountLabel: input.discountLabel,
        features: {
          create: input.features.map((f, i) => ({
            name: f.name,
            included: f.included,
            value: f.value,
            icon: f.icon,
            sortOrder: f.sortOrder ?? i,
          })),
        },
      },
      include: {
        features: { orderBy: { sortOrder: 'asc' } },
        pricing: true,
      },
    });

    // Create pricing entries + Razorpay plans for PAID plans
    if (input.planType === 'PAID' && input.pricing && input.pricing.length > 0) {
      for (const p of input.pricing) {
        let razorpayPlanId: string | null = null;

        // Create Razorpay plan for recurring billing cycles
        if (p.price > 0 && p.billingCycle !== 'ONETIME') {
          try {
            razorpayPlanId = await RazorpayService.createPlan({
              name: `${input.name} - ${formatBillingCycle(p.billingCycle)}`,
              amount: p.price,
              currency: input.currency || 'INR',
              billingCycle: p.billingCycle,
              description: input.description,
            });
          } catch (error: any) {
            console.error(`⚠️ Razorpay plan creation failed for ${p.billingCycle}:`, error?.message || error);
            console.error(`   Plan will be saved without Razorpay sync. Use syncRazorpayPlans() to retry later.`);
            // Don't throw — save the plan anyway, admin can sync later
          }
        }

        await prisma.planPricing.create({
          data: {
            planId: plan.id,
            billingCycle: p.billingCycle,
            price: p.price,
            razorpayPlanId,
          },
        });
      }
    }

    // Invalidate cache
    await CacheService.del(CACHE_KEYS.ACTIVE_PLANS);

    // Return full plan with pricing
    return PlanService.getPlanById(plan.id);
  }

  /**
   * Sync Razorpay plans for pricing records that have null razorpayPlanId.
   * This is a recovery mechanism for plans that were created while Razorpay was unavailable.
   */
  static async syncRazorpayPlans(planId?: string) {
    const where: any = { razorpayPlanId: null, isActive: true };
    if (planId) where.planId = planId;

    const unsynced = await prisma.planPricing.findMany({
      where,
      include: { plan: true },
    });

    // Filter out ONETIME and FREE plans
    const toSync = unsynced.filter(p => 
      p.billingCycle !== 'ONETIME' && 
      p.plan.planType === 'PAID' && 
      p.price > 0
    );

    if (toSync.length === 0) {
      return { synced: 0, failed: 0, message: 'All pricing records already have Razorpay plans' };
    }

    let synced = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const pricing of toSync) {
      try {
        const razorpayPlanId = await RazorpayService.createPlan({
          name: `${pricing.plan.name} - ${formatBillingCycle(pricing.billingCycle as BillingCycleType)}`,
          amount: pricing.price,
          currency: pricing.plan.currency,
          billingCycle: pricing.billingCycle as BillingCycleType,
          description: pricing.plan.description,
        });

        await prisma.planPricing.update({
          where: { id: pricing.id },
          data: { razorpayPlanId },
        });

        synced++;
        console.log(`✅ Synced: ${pricing.plan.name} (${pricing.billingCycle}) → ${razorpayPlanId}`);
      } catch (error: any) {
        failed++;
        const msg = `${pricing.plan.name} (${pricing.billingCycle}): ${error?.message || 'Unknown error'}`;
        errors.push(msg);
        console.error(`❌ Failed to sync: ${msg}`);
      }
    }

    // Invalidate cache after sync
    await CacheService.del(CACHE_KEYS.ACTIVE_PLANS);

    return { synced, failed, total: toSync.length, errors };
  }


  /**
   * Update an existing plan
   */
  static async updatePlan(id: string, input: UpdatePlanInput) {
    const existing = await prisma.plan.findUnique({
      where: { id },
      include: { pricing: true },
    });
    if (!existing) throw new AppError('Plan not found', 404);

    // Handle features update
    if (input.features) {
      await prisma.planFeature.deleteMany({ where: { planId: id } });
      await prisma.planFeature.createMany({
        data: input.features.map((f, i) => ({
          planId: id,
          name: f.name,
          included: f.included,
          value: f.value,
          icon: f.icon,
          sortOrder: f.sortOrder ?? i,
        })),
      });
    }

    // Handle pricing update
    if (input.pricing) {
      // Delete old pricing
      await prisma.planPricing.deleteMany({ where: { planId: id } });

      // Create new pricing entries with Razorpay sync
      const planType = input.planType || existing.planType;
      if (planType === 'PAID') {
        for (const p of input.pricing) {
          let razorpayPlanId: string | null = null;

          if (p.price > 0 && p.billingCycle !== 'ONETIME') {
            try {
              razorpayPlanId = await RazorpayService.createPlan({
                name: `${input.name || existing.name} - ${formatBillingCycle(p.billingCycle)}`,
                amount: p.price,
                currency: existing.currency,
                billingCycle: p.billingCycle,
              });
            } catch (error) {
              console.error(`Failed to create Razorpay plan for ${p.billingCycle}:`, error);
            }
          }

          await prisma.planPricing.create({
            data: {
              planId: id,
              billingCycle: p.billingCycle,
              price: p.price,
              razorpayPlanId,
            },
          });
        }
      }
    }

    // Build update data (only include fields that are provided)
    const updateData: any = {};
    if (input.name !== undefined) updateData.name = input.name;
    if (input.slug !== undefined) updateData.slug = input.slug;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.planType !== undefined) updateData.planType = input.planType;
    if (input.itemCategory !== undefined) updateData.itemCategory = input.itemCategory;
    if (input.bannerBadge !== undefined) updateData.bannerBadge = input.bannerBadge;
    if (input.images !== undefined) updateData.images = input.images;
    if (input.isPopular !== undefined) updateData.isPopular = input.isPopular;
    if (input.isActive !== undefined) updateData.isActive = input.isActive;
    if (input.sortOrder !== undefined) updateData.sortOrder = input.sortOrder;
    if (input.stockLimit !== undefined) updateData.stockLimit = input.stockLimit;
    if (input.taxPercentage !== undefined) updateData.taxPercentage = input.taxPercentage;
    if (input.isOneTime !== undefined) updateData.isOneTime = input.isOneTime;
    if (input.oneTimePrice !== undefined) updateData.oneTimePrice = input.oneTimePrice;
    if (input.freeTrialEnabled !== undefined) updateData.freeTrialEnabled = input.freeTrialEnabled;
    if (input.freeTrialDays !== undefined) updateData.freeTrialDays = input.freeTrialDays;
    if (input.discountPercent !== undefined) updateData.discountPercent = input.discountPercent;
    if (input.discountLabel !== undefined) updateData.discountLabel = input.discountLabel;

    // Update plan
    await prisma.plan.update({
      where: { id },
      data: updateData,
    });

    // Invalidate caches
    await CacheService.del(CACHE_KEYS.ACTIVE_PLANS);
    await CacheService.del(CACHE_KEYS.PLAN(id));

    return PlanService.getPlanById(id);
  }

  /**
   * Duplicate a plan
   */
  static async duplicatePlan(id: string) {
    const source = await PlanService.getPlanById(id);

    // Generate unique slug
    let newSlug = `${source.slug}-copy`;
    let counter = 1;
    while (await prisma.plan.findUnique({ where: { slug: newSlug } })) {
      newSlug = `${source.slug}-copy-${counter++}`;
    }

    return PlanService.createPlan({
      name: `${source.name} (Copy)`,
      slug: newSlug,
      description: source.description,
      planType: source.planType as 'FREE' | 'PAID',
      currency: source.currency,
      bannerBadge: source.bannerBadge || undefined,
      isPopular: false,
      sortOrder: source.sortOrder + 1,
      isOneTime: source.isOneTime,
      oneTimePrice: source.oneTimePrice || undefined,
      freeTrialEnabled: source.freeTrialEnabled,
      freeTrialDays: source.freeTrialDays || undefined,
      discountPercent: source.discountPercent || undefined,
      discountLabel: source.discountLabel || undefined,
      pricing: source.pricing.map(p => ({
        billingCycle: p.billingCycle as BillingCycleType,
        price: p.price,
      })),
      features: source.features.map(f => ({
        name: f.name,
        included: f.included,
        value: f.value || undefined,
        icon: f.icon || undefined,
        sortOrder: f.sortOrder,
      })),
    });
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
      await prisma.planPricing.deleteMany({ where: { planId: id } });
      await prisma.planFeature.deleteMany({ where: { planId: id } });
      await prisma.bundlePlan.deleteMany({ where: { planId: id } });
      await prisma.plan.delete({ where: { id } });
    }

    // Invalidate cache
    await CacheService.del(CACHE_KEYS.ACTIVE_PLANS);
    await CacheService.del(CACHE_KEYS.PLAN(id));

    return { message: 'Plan deleted successfully' };
  }

  /**
   * Apply discount to multiple plans at once
   */
  static async bulkApplyDiscount(planIds: string[], discountPercent: number, discountLabel?: string) {
    await prisma.plan.updateMany({
      where: { id: { in: planIds } },
      data: { discountPercent, discountLabel: discountLabel || null },
    });

    await CacheService.del(CACHE_KEYS.ACTIVE_PLANS);
    return { message: `Discount applied to ${planIds.length} plans` };
  }

  /**
   * Remove discount from multiple plans
   */
  static async bulkRemoveDiscount(planIds: string[]) {
    await prisma.plan.updateMany({
      where: { id: { in: planIds } },
      data: { discountPercent: null, discountLabel: null },
    });

    await CacheService.del(CACHE_KEYS.ACTIVE_PLANS);
    return { message: `Discount removed from ${planIds.length} plans` };
  }

  // ── Bundle CRUD ────────────────────────────────────────

  /**
   * Get all bundles (admin)
   */
  static async getAllBundles() {
    return prisma.planBundle.findMany({
      include: {
        plans: {
          include: {
            plan: {
              include: {
                features: { orderBy: { sortOrder: 'asc' } },
                pricing: { where: { isActive: true } },
              },
            },
          },
        },
        _count: { select: { subscriptions: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get active bundles (public)
   */
  static async getActiveBundles() {
    return prisma.planBundle.findMany({
      where: { isActive: true },
      include: {
        plans: {
          include: {
            plan: {
              include: {
                features: { orderBy: { sortOrder: 'asc' } },
                pricing: { where: { isActive: true } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Create a bundle
   */
  static async createBundle(input: CreateBundleInput) {
    // Check slug uniqueness
    const existing = await prisma.planBundle.findUnique({ where: { slug: input.slug } });
    if (existing) throw new AppError('A bundle with this slug already exists', 409);

    // Verify all plans exist
    const plans = await prisma.plan.findMany({
      where: { id: { in: input.planIds } },
    });
    if (plans.length !== input.planIds.length) {
      throw new AppError('One or more plan IDs are invalid', 400);
    }

    const bundle = await prisma.planBundle.create({
      data: {
        name: input.name,
        slug: input.slug,
        description: input.description,
        price: input.price,
        currency: input.currency || 'INR',
        plans: {
          create: input.planIds.map(planId => ({ planId })),
        },
      },
      include: {
        plans: { include: { plan: true } },
      },
    });

    return bundle;
  }

  /**
   * Update a bundle
   */
  static async updateBundle(id: string, input: UpdateBundleInput) {
    const existing = await prisma.planBundle.findUnique({ where: { id } });
    if (!existing) throw new AppError('Bundle not found', 404);

    // Handle plan list update
    if (input.planIds) {
      await prisma.bundlePlan.deleteMany({ where: { bundleId: id } });
      await prisma.bundlePlan.createMany({
        data: input.planIds.map(planId => ({ bundleId: id, planId })),
      });
    }

    const updateData: any = {};
    if (input.name !== undefined) updateData.name = input.name;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.price !== undefined) updateData.price = input.price;
    if (input.isActive !== undefined) updateData.isActive = input.isActive;

    const bundle = await prisma.planBundle.update({
      where: { id },
      data: updateData,
      include: {
        plans: { include: { plan: true } },
        _count: { select: { subscriptions: true } },
      },
    });

    return bundle;
  }

  /**
   * Delete a bundle
   */
  static async deleteBundle(id: string) {
    const bundle = await prisma.planBundle.findUnique({
      where: { id },
      include: { _count: { select: { subscriptions: { where: { status: 'ACTIVE' } } } } },
    });

    if (!bundle) throw new AppError('Bundle not found', 404);

    if (bundle._count.subscriptions > 0) {
      await prisma.planBundle.update({ where: { id }, data: { isActive: false } });
    } else {
      await prisma.bundlePlan.deleteMany({ where: { bundleId: id } });
      await prisma.planBundle.delete({ where: { id } });
    }

    return { message: 'Bundle deleted successfully' };
  }
}

// ── Helper ───────────────────────────────────────────────

function formatBillingCycle(cycle: BillingCycleType): string {
  const labels: Record<BillingCycleType, string> = {
    DAILY: 'Daily',
    WEEKLY: 'Weekly',
    BIWEEKLY: 'Bi-weekly',
    MONTHLY: 'Monthly',
    QUARTERLY: 'Quarterly',
    HALFYEARLY: 'Half-yearly',
    ANNUALLY: 'Annually',
    ONETIME: 'One-time',
  };
  return labels[cycle] || cycle;
}
