// ─────────────────────────────────────────────────────────
// CAFT Financial — Payment Service (Webhooks + History)
//
// Handles all 10 Razorpay webhook events:
//   payment.authorized   → Log pending payment
//   payment.pending       → Update payment to pending state
//   payment.captured      → Mark captured + send receipt email
//   payment.failed        → Mark failed + send failure email
//   order.paid            → Update order-linked payment
//   order.notification.delivered → Audit log only
//   order.notification.failed   → Audit log only
//   subscription.activated  → Activate sub + welcome email
//   subscription.charged    → Record renewal + receipt email
//   subscription.cancelled  → Cancel sub + notification email
// ─────────────────────────────────────────────────────────

import { prisma } from '../config/database';
import { AppError } from '../utils/apiResponse';
import { RazorpayWebhookPayload } from '../types';
import { EmailService } from './email.service';
import { CacheService, CACHE_KEYS } from './cache.service';
import { formatCurrency } from '../utils/helpers';

export class PaymentService {
  /**
   * Get user's payment history with pagination
   */
  static async getPaymentHistory(userId: string, page: number, limit: number) {
    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where: { userId },
        include: { subscription: { include: { plan: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.payment.count({ where: { userId } }),
    ]);
    return { payments, total };
  }

  /**
   * Get single payment by ID
   */
  static async getPaymentById(userId: string, paymentId: string) {
    const payment = await prisma.payment.findFirst({
      where: { id: paymentId, userId },
      include: { subscription: { include: { plan: true } } },
    });
    if (!payment) throw new AppError('Payment not found', 404);
    return payment;
  }

  // ── Webhook Router ───────────────────────────────────

  /**
   * Route incoming Razorpay webhook to the correct handler.
   * Every event is audit-logged for the admin dashboard.
   */
  static async handleWebhook(payload: RazorpayWebhookPayload) {
    const { event } = payload;
    console.log(`📨 Razorpay webhook: ${event}`);

    switch (event) {
      // ── Payment Events ──────────────────────────────
      case 'payment.authorized':
        await PaymentService.handlePaymentAuthorized(payload);
        break;
      case 'payment.pending':
        await PaymentService.handlePaymentPending(payload);
        break;
      case 'payment.captured':
        await PaymentService.handlePaymentCaptured(payload);
        break;
      case 'payment.failed':
        await PaymentService.handlePaymentFailed(payload);
        break;

      // ── Order Events ────────────────────────────────
      case 'order.paid':
        await PaymentService.handleOrderPaid(payload);
        break;
      case 'order.notification.delivered':
        await PaymentService.logWebhookEvent(payload, 'Order notification delivered to customer');
        break;
      case 'order.notification.failed':
        await PaymentService.logWebhookEvent(payload, 'Order notification delivery failed');
        break;

      // ── Subscription Events ─────────────────────────
      case 'subscription.activated':
        await PaymentService.handleSubscriptionActivated(payload);
        break;
      case 'subscription.charged':
        await PaymentService.handleSubscriptionCharged(payload);
        break;
      case 'subscription.cancelled':
        await PaymentService.handleSubscriptionCancelled(payload);
        break;

      default:
        console.log(`⚠️ Unhandled webhook event: ${event}`);
        await PaymentService.logWebhookEvent(payload, `Unhandled event: ${event}`);
    }
  }

  // ── Payment Handlers ─────────────────────────────────

  private static async handlePaymentAuthorized(payload: RazorpayWebhookPayload) {
    const paymentEntity = payload.payload.payment?.entity;
    if (!paymentEntity) return;

    const existing = await prisma.payment.findUnique({
      where: { razorpayPaymentId: paymentEntity.id },
    });

    if (existing) {
      await prisma.payment.update({
        where: { id: existing.id },
        data: { status: 'AUTHORIZED', method: paymentEntity.method },
      });
    }

    await PaymentService.logWebhookEvent(payload,
      `Payment ${paymentEntity.id} authorized — ${formatCurrency(paymentEntity.amount)}`,
      existing?.userId
    );
  }

  private static async handlePaymentPending(payload: RazorpayWebhookPayload) {
    const paymentEntity = payload.payload.payment?.entity;
    if (!paymentEntity) return;

    const existing = await prisma.payment.findUnique({
      where: { razorpayPaymentId: paymentEntity.id },
    });

    if (existing) {
      await prisma.payment.update({
        where: { id: existing.id },
        data: { status: 'CREATED', method: paymentEntity.method },
      });
    }

    await PaymentService.logWebhookEvent(payload,
      `Payment ${paymentEntity.id} pending — ${formatCurrency(paymentEntity.amount)}`,
      existing?.userId
    );
  }

  private static async handlePaymentCaptured(payload: RazorpayWebhookPayload) {
    const paymentEntity = payload.payload.payment?.entity;
    if (!paymentEntity) return;

    const existing = await prisma.payment.findUnique({
      where: { razorpayPaymentId: paymentEntity.id },
    });

    if (existing) {
      await prisma.payment.update({
        where: { id: existing.id },
        data: { status: 'CAPTURED', method: paymentEntity.method },
      });
    }

    // Send receipt email
    const user = existing
      ? await prisma.user.findUnique({ where: { id: existing.userId } })
      : null;

    if (user) {
      const sub = existing?.subscriptionId
        ? await prisma.subscription.findUnique({ where: { id: existing.subscriptionId }, include: { plan: true } })
        : null;

      await EmailService.sendPaymentSuccessEmail(
        user.email, user.name,
        paymentEntity.amount,
        sub?.plan?.name || 'CAFT Service',
        paymentEntity.id
      );
    }

    await PaymentService.logWebhookEvent(payload,
      `Payment ${paymentEntity.id} captured — ${formatCurrency(paymentEntity.amount)} via ${paymentEntity.method}`,
      existing?.userId
    );

    // Invalidate stats cache so admin dashboard reflects the new revenue
    await CacheService.del(CACHE_KEYS.STATS_OVERVIEW);
  }

  private static async handlePaymentFailed(payload: RazorpayWebhookPayload) {
    const paymentEntity = payload.payload.payment?.entity;
    if (!paymentEntity) return;

    const existing = await prisma.payment.findUnique({
      where: { razorpayPaymentId: paymentEntity.id },
    });

    if (existing) {
      await prisma.payment.update({
        where: { id: existing.id },
        data: { status: 'FAILED', failureReason: paymentEntity.error_description || 'Unknown error' },
      });

      const user = await prisma.user.findUnique({ where: { id: existing.userId } });
      if (user) {
        await EmailService.sendPaymentFailureEmail(
          user.email, user.name, paymentEntity.amount,
          paymentEntity.error_description || 'Payment could not be processed'
        );
      }
    }

    await PaymentService.logWebhookEvent(payload,
      `Payment ${paymentEntity.id} failed — ${paymentEntity.error_description || paymentEntity.error_code || 'Unknown'}`,
      existing?.userId
    );
  }

  // ── Order Handlers ───────────────────────────────────

  private static async handleOrderPaid(payload: RazorpayWebhookPayload) {
    const orderEntity = payload.payload.order?.entity;
    const paymentEntity = payload.payload.payment?.entity;
    if (!orderEntity) return;

    // If the payment entity is present, try to update the payment record
    if (paymentEntity) {
      const existing = await prisma.payment.findUnique({
        where: { razorpayPaymentId: paymentEntity.id },
      });
      if (existing && existing.status !== 'CAPTURED') {
        await prisma.payment.update({
          where: { id: existing.id },
          data: { status: 'CAPTURED', method: paymentEntity.method },
        });
      }
    }

    await PaymentService.logWebhookEvent(payload,
      `Order ${orderEntity.id} paid — ${formatCurrency(orderEntity.amount)} (status: ${orderEntity.status})`
    );

    await CacheService.del(CACHE_KEYS.STATS_OVERVIEW);
  }

  // ── Subscription Handlers ────────────────────────────

  private static async handleSubscriptionActivated(payload: RazorpayWebhookPayload) {
    const subEntity = payload.payload.subscription?.entity;
    if (!subEntity) return;

    const subscription = await prisma.subscription.findUnique({
      where: { razorpaySubscriptionId: subEntity.id },
      include: { plan: true, user: true },
    });

    if (subscription) {
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          status: 'ACTIVE',
          currentPeriodStart: subEntity.current_start ? new Date(subEntity.current_start * 1000) : undefined,
          currentPeriodEnd: subEntity.current_end ? new Date(subEntity.current_end * 1000) : undefined,
        },
      });

      // Invalidate subscription cache
      await CacheService.del(CACHE_KEYS.USER_SUBSCRIPTION(subscription.userId));
      await CacheService.del(CACHE_KEYS.STATS_OVERVIEW);

      // Send activation email
      const periodEnd = subEntity.current_end
        ? new Date(subEntity.current_end * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
        : 'N/A';

      await EmailService.sendSubscriptionActivatedEmail(
        subscription.user.email,
        subscription.user.name,
        subscription.plan.name,
        periodEnd
      );
    }

    await PaymentService.logWebhookEvent(payload,
      `Subscription ${subEntity.id} activated (plan: ${subscription?.plan?.name || 'unknown'})`,
      subscription?.userId
    );
  }

  private static async handleSubscriptionCharged(payload: RazorpayWebhookPayload) {
    const subEntity = payload.payload.subscription?.entity;
    const paymentEntity = payload.payload.payment?.entity;
    if (!subEntity) return;

    const subscription = await prisma.subscription.findUnique({
      where: { razorpaySubscriptionId: subEntity.id },
      include: { plan: true, user: true },
    });

    if (subscription && paymentEntity) {
      // Record the renewal payment
      await prisma.payment.create({
        data: {
          userId: subscription.userId,
          subscriptionId: subscription.id,
          razorpayPaymentId: paymentEntity.id,
          amount: paymentEntity.amount,
          currency: paymentEntity.currency,
          status: 'CAPTURED',
          method: paymentEntity.method,
          description: `Recurring: ${subscription.plan.name}`,
        },
      });

      // Update billing period
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          currentPeriodStart: subEntity.current_start ? new Date(subEntity.current_start * 1000) : undefined,
          currentPeriodEnd: subEntity.current_end ? new Date(subEntity.current_end * 1000) : undefined,
        },
      });

      // Invalidate caches
      await CacheService.del(CACHE_KEYS.USER_SUBSCRIPTION(subscription.userId));
      await CacheService.del(CACHE_KEYS.STATS_OVERVIEW);

      // Send renewal receipt email
      await EmailService.sendSubscriptionChargedEmail(
        subscription.user.email,
        subscription.user.name,
        subscription.plan.name,
        paymentEntity.amount,
        paymentEntity.id
      );
    }

    await PaymentService.logWebhookEvent(payload,
      `Subscription ${subEntity.id} charged — ${paymentEntity ? formatCurrency(paymentEntity.amount) : 'unknown amount'}`,
      subscription?.userId
    );
  }

  private static async handleSubscriptionCancelled(payload: RazorpayWebhookPayload) {
    const subEntity = payload.payload.subscription?.entity;
    if (!subEntity) return;

    const subscription = await prisma.subscription.findUnique({
      where: { razorpaySubscriptionId: subEntity.id },
      include: { plan: true, user: true },
    });

    if (subscription) {
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: { status: 'CANCELLED', cancelledAt: new Date() },
      });

      // Invalidate caches
      await CacheService.del(CACHE_KEYS.USER_SUBSCRIPTION(subscription.userId));
      await CacheService.del(CACHE_KEYS.STATS_OVERVIEW);

      // Send cancellation email
      await EmailService.sendSubscriptionCancelledEmail(
        subscription.user.email,
        subscription.user.name,
        subscription.plan.name
      );
    }

    await PaymentService.logWebhookEvent(payload,
      `Subscription ${subEntity.id} cancelled (plan: ${subscription?.plan?.name || 'unknown'})`,
      subscription?.userId
    );
  }

  // ── Audit Logger ─────────────────────────────────────

  /**
   * Write every webhook event to the audit_logs table.
   * This feeds the admin dashboard's activity log.
   */
  private static async logWebhookEvent(
    payload: RazorpayWebhookPayload,
    details: string,
    userId?: string | null
  ) {
    try {
      await prisma.auditLog.create({
        data: {
          userId: userId || null,
          action: `WEBHOOK_${payload.event.toUpperCase().replace(/\./g, '_')}`,
          entity: 'Payment',
          entityId: payload.payload.payment?.entity?.id
            || payload.payload.subscription?.entity?.id
            || payload.payload.order?.entity?.id
            || null,
          details,
        },
      });
    } catch (err) {
      // Audit logging should never break the webhook response
      console.error('⚠️ Failed to write audit log:', (err as Error).message);
    }
  }
}
