// ─────────────────────────────────────────────────────────
// CAFT Financial — Purchase Service (One-time & Physical)
//
// Handles:
//   - One-time purchases for digital products & services
//   - Physical product purchases (always order-based)
//   - Stock management for physical products
//   - Pricing calculation with category-level inheritance
// ─────────────────────────────────────────────────────────

import { prisma } from '../config/database';
import { AppError } from '../utils/apiResponse';
import { RazorpayService } from './razorpay.service';
import { CacheService, CACHE_KEYS } from './cache.service';

/**
 * Compute a charge amount given a mode (PERCENT or FLAT) and value.
 * For PERCENT mode, value is a percentage of the base item price.
 * For FLAT mode, value is in paise directly.
 */
function computeCharge(mode: string, value: number, itemPrice: number): number {
  if (mode === 'PERCENT') {
    return Math.round(itemPrice * value / 100);
  }
  return Math.round(value); // FLAT — already in paise
}

export class PurchaseService {
  /**
   * Calculate the full pricing breakdown for a product.
   * Uses product-level overrides if set, otherwise falls back to category pricing.
   */
  static async calculatePricing(plan: any, quantity: number = 1) {
    // Get the base item price
    const itemPrice = plan.oneTimePrice || 0;
    if (itemPrice <= 0) {
      throw new AppError('Product price not configured', 400);
    }

    // Load category pricing
    const categoryPricing = await prisma.categoryPricing.findUnique({
      where: { itemCategory: plan.itemCategory },
    });

    // Helper: get effective mode & value (product override > category default > zero)
    const getEffective = (
      productMode: string | null | undefined,
      productValue: number | null | undefined,
      catMode: string | undefined,
      catValue: number | undefined,
    ) => {
      if (productMode != null && productValue != null) {
        return { mode: productMode, value: productValue };
      }
      if (catMode != null && catValue != null) {
        return { mode: catMode, value: catValue };
      }
      return { mode: 'PERCENT', value: 0 };
    };

    const gst = getEffective(plan.gstMode, plan.gstValue, categoryPricing?.gstMode, categoryPricing?.gstValue);
    const gateway = getEffective(plan.gatewayChargeMode, plan.gatewayChargeValue, categoryPricing?.gatewayChargeMode, categoryPricing?.gatewayChargeValue);
    const service = getEffective(plan.serviceFeeMode, plan.serviceFeeValue, categoryPricing?.serviceFeeMode, categoryPricing?.serviceFeeValue);
    const processing = getEffective(plan.processingFeeMode, plan.processingFeeValue, categoryPricing?.processingFeeMode, categoryPricing?.processingFeeValue);
    const platform = getEffective(plan.platformChargeMode, plan.platformChargeValue, categoryPricing?.platformChargeMode, categoryPricing?.platformChargeValue);

    const gstAmount = computeCharge(gst.mode, gst.value, itemPrice);
    const gatewayCharge = computeCharge(gateway.mode, gateway.value, itemPrice);
    const serviceFee = computeCharge(service.mode, service.value, itemPrice);
    const processingFee = computeCharge(processing.mode, processing.value, itemPrice);
    const platformCharge = computeCharge(platform.mode, platform.value, itemPrice);

    const unitPrice = itemPrice + gstAmount + gatewayCharge + serviceFee + processingFee + platformCharge;

    // Apply discount if any
    let discountedUnitPrice = unitPrice;
    if (plan.discountPercent && plan.discountPercent > 0) {
      discountedUnitPrice = Math.round(unitPrice * (1 - plan.discountPercent / 100));
    }

    const totalAmount = discountedUnitPrice * quantity;

    return {
      itemPrice,
      gstAmount,
      gatewayCharge,
      serviceFee,
      processingFee,
      platformCharge,
      unitPrice: discountedUnitPrice,
      totalAmount,
      quantity,
    };
  }

  /**
   * Create a purchase (one-time or physical product).
   * Creates a Razorpay Order (NOT a subscription).
   */
  static async createPurchase(userId: string, planId: string, quantity: number = 1) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError('User not found', 404);

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(planId);
    const plan = await prisma.plan.findFirst({
      where: isUuid ? { id: planId } : { slug: planId },
    });
    if (!plan || !plan.isActive) throw new AppError('Product not found or inactive', 404);

    // For physical products, check stock
    if (plan.itemCategory === 'PHYSICAL_PRODUCT') {
      if (plan.stockLimit !== null) {
        const available = plan.stockLimit - plan.stockSold;
        if (available < quantity) {
          throw new AppError(`Only ${available} units available in stock`, 400);
        }
      }
    }

    // For digital products/services — check if already purchased (one-time)
    if ((plan.itemCategory === 'DIGITAL_PRODUCT' || plan.itemCategory === 'SERVICE') && plan.isOneTime) {
      const alreadyOwns = await prisma.purchase.findFirst({
        where: { userId, planId: plan.id, status: 'PAID' },
      });
      if (alreadyOwns) {
        throw new AppError('You already own this product.', 409);
      }
    }

    // Calculate pricing
    const pricing = await PurchaseService.calculatePricing(plan, quantity);

    // Clean up stale CREATED purchases for this user+plan
    await prisma.purchase.deleteMany({
      where: { userId, planId: plan.id, status: 'CREATED' },
    });

    // Create Razorpay Order
    const order = await RazorpayService.createOrder({
      amount: pricing.totalAmount,
      currency: plan.currency || 'INR',
      description: `Purchase: ${plan.name}${quantity > 1 ? ` x${quantity}` : ''}`,
      notes: {
        plan_id: plan.id,
        user_id: userId,
        type: plan.itemCategory === 'PHYSICAL_PRODUCT' ? 'physical' : 'one_time',
        quantity: String(quantity),
      },
    });

    // Save purchase in DB
    const purchase = await prisma.purchase.create({
      data: {
        userId,
        planId: plan.id,
        razorpayOrderId: order.orderId,
        quantity,
        unitPrice: pricing.unitPrice,
        totalAmount: pricing.totalAmount,
        currency: plan.currency || 'INR',
        status: 'CREATED',
        itemPrice: pricing.itemPrice,
        gstAmount: pricing.gstAmount,
        gatewayCharge: pricing.gatewayCharge,
        serviceFee: pricing.serviceFee,
        processingFee: pricing.processingFee,
        platformCharge: pricing.platformCharge,
      },
      include: { plan: true },
    });

    return {
      purchase,
      purchaseId: purchase.id,
      orderId: order.orderId,
      amount: order.amount,
      currency: order.currency,
      pricingBreakdown: pricing,
    };
  }

  /**
   * Verify a purchase payment (after Razorpay checkout).
   * This is the client-side callback — sets status to PAID only after
   * signature verification. The webhook will also confirm.
   */
  static async verifyPurchasePayment(
    userId: string,
    razorpayPaymentId: string,
    razorpayOrderId: string,
    razorpaySignature: string,
    purchaseId: string
  ) {
    // Verify Razorpay signature
    const isSignatureValid = RazorpayService.verifyPaymentSignature({
      orderId: razorpayOrderId,
      paymentId: razorpayPaymentId,
      signature: razorpaySignature,
    });
    if (!isSignatureValid) {
      throw new AppError('Invalid payment signature — potential fraud attempt', 400);
    }

    const purchase = await prisma.purchase.findUnique({
      where: { id: purchaseId },
      include: { plan: true },
    });

    if (!purchase || purchase.userId !== userId) {
      throw new AppError('Purchase not found', 404);
    }

    // Idempotency: if this purchase was already verified and paid, return success
    // without re-running the side-effects (stock increment, payment record creation).
    // This covers webhook retries and double-tap of the verify endpoint.
    if (purchase.status === 'PAID') {
      return { message: 'Payment already verified and purchase completed' };
    }

    if (purchase.status !== 'CREATED') {
      throw new AppError(`Cannot verify a purchase in '${purchase.status}' status`, 409);
    }

    // Update purchase status to PAID
    await prisma.purchase.update({
      where: { id: purchase.id },
      data: { status: 'PAID' },
    });

    // For physical products, increment stockSold
    if (purchase.plan.itemCategory === 'PHYSICAL_PRODUCT') {
      await prisma.plan.update({
        where: { id: purchase.planId },
        data: { stockSold: { increment: purchase.quantity } },
      });
    }

    // Record payment
    await prisma.payment.create({
      data: {
        userId,
        purchaseId: purchase.id,
        razorpayPaymentId,
        razorpayOrderId,
        razorpaySignature,
        amount: purchase.totalAmount,
        currency: purchase.currency,
        status: 'CAPTURED',
        description: `Purchase: ${purchase.plan.name}${purchase.quantity > 1 ? ` x${purchase.quantity}` : ''}`,
      },
    });

    await CacheService.del(CACHE_KEYS.USER_SUBSCRIPTION(userId));

    // ── Auto-enroll in any courses linked to this plan ────────────
    // Non-fatal: if enrollment creation fails, the webhook or a
    // subsequent getCourse call will re-trigger it.
    try {
      const linkedCourses = await prisma.course.findMany({
        where: { planId: purchase.planId, isPublished: true },
        select: { id: true },
      });
      if (linkedCourses.length > 0) {
        await Promise.all(
          linkedCourses.map(course =>
            prisma.courseEnrollment.upsert({
              where: { userId_courseId: { userId, courseId: course.id } },
              create: {
                userId,
                courseId: course.id,
                purchaseId: purchase.id,
                accessType: 'FULL',
                isActive: true,
              },
              update: {
                isActive: true,
                accessType: 'FULL',
                purchaseId: purchase.id,
              },
            }),
          ),
        );
      }
    } catch (enrollErr) {
      console.error('[PurchaseService] Auto-enrollment failed (non-fatal):', enrollErr);
    }

    return { message: 'Payment verified and purchase completed' };
  }

  /**
   * Get user's purchases (active/completed)
   */
  static async getUserPurchases(userId: string) {
    return prisma.purchase.findMany({
      where: { userId, status: { in: ['PAID', 'SHIPPED', 'DELIVERED'] } },
      include: { plan: { include: { features: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get user's full access list — all active subscriptions + all purchased products.
   * This is what the frontend uses to determine what to show as "Subscribed" or "Purchased".
   */
  static async getUserAccess(userId: string) {
    const [subscriptions, purchases] = await Promise.all([
      prisma.subscription.findMany({
        where: { userId, status: 'ACTIVE' },
        include: {
          plan: { include: { features: true, pricing: true } },
          bundle: { include: { plans: { include: { plan: true } } } },
        },
      }),
      prisma.purchase.findMany({
        where: { userId, status: { in: ['PAID', 'SHIPPED', 'DELIVERED'] } },
        include: { plan: { include: { features: true } } },
      }),
    ]);

    // Build a set of plan IDs the user has access to
    const accessiblePlanIds = new Set<string>();

    // From subscriptions
    for (const sub of subscriptions) {
      accessiblePlanIds.add(sub.planId);
      // If it's a bundle subscription, include all bundled plans
      if (sub.bundle) {
        for (const bp of sub.bundle.plans) {
          accessiblePlanIds.add(bp.planId);
        }
      }
    }

    // From purchases
    for (const purchase of purchases) {
      accessiblePlanIds.add(purchase.planId);
    }

    return {
      subscriptions,
      purchases,
      accessiblePlanIds: Array.from(accessiblePlanIds),
    };
  }
}
