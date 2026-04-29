// ─────────────────────────────────────────────────────────
// CAFT Financial — Payment Service (Webhooks + History)
// ─────────────────────────────────────────────────────────

import { prisma } from '../config/database';
import { AppError } from '../utils/apiResponse';
import { RazorpayWebhookPayload } from '../types';
import { EmailService } from './email.service';
import { CacheService, CACHE_KEYS } from './cache.service';

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

  /**
   * Handle Razorpay webhook events
   */
  static async handleWebhook(payload: RazorpayWebhookPayload) {
    const { event } = payload;
    console.log(`📨 Razorpay webhook: ${event}`);

    switch (event) {
      case 'payment.captured':
        await PaymentService.handlePaymentCaptured(payload);
        break;
      case 'payment.failed':
        await PaymentService.handlePaymentFailed(payload);
        break;
      case 'subscription.activated':
        await PaymentService.handleSubscriptionActivated(payload);
        break;
      case 'subscription.cancelled':
        await PaymentService.handleSubscriptionCancelled(payload);
        break;
      case 'subscription.charged':
        await PaymentService.handleSubscriptionCharged(payload);
        break;
      case 'subscription.halted':
        await PaymentService.handleSubscriptionHalted(payload);
        break;
      default:
        console.log(`Unhandled webhook event: ${event}`);
    }
  }

  private static async handlePaymentCaptured(payload: RazorpayWebhookPayload) {
    const paymentEntity = payload.payload.payment?.entity;
    if (!paymentEntity) return;

    // Find or create payment record
    const existing = await prisma.payment.findUnique({
      where: { razorpayPaymentId: paymentEntity.id },
    });

    if (existing) {
      await prisma.payment.update({
        where: { id: existing.id },
        data: { status: 'CAPTURED', method: paymentEntity.method },
      });
    }

    // Send success email
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
  }

  private static async handleSubscriptionActivated(payload: RazorpayWebhookPayload) {
    const subEntity = payload.payload.subscription?.entity;
    if (!subEntity) return;

    await prisma.subscription.updateMany({
      where: { razorpaySubscriptionId: subEntity.id },
      data: {
        status: 'ACTIVE',
        currentPeriodStart: subEntity.current_start ? new Date(subEntity.current_start * 1000) : undefined,
        currentPeriodEnd: subEntity.current_end ? new Date(subEntity.current_end * 1000) : undefined,
      },
    });
  }

  private static async handleSubscriptionCancelled(payload: RazorpayWebhookPayload) {
    const subEntity = payload.payload.subscription?.entity;
    if (!subEntity) return;

    await prisma.subscription.updateMany({
      where: { razorpaySubscriptionId: subEntity.id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
  }

  private static async handleSubscriptionCharged(payload: RazorpayWebhookPayload) {
    const subEntity = payload.payload.subscription?.entity;
    const paymentEntity = payload.payload.payment?.entity;
    if (!subEntity) return;

    const subscription = await prisma.subscription.findUnique({
      where: { razorpaySubscriptionId: subEntity.id },
      include: { plan: true },
    });

    if (subscription && paymentEntity) {
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

      await prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          currentPeriodStart: subEntity.current_start ? new Date(subEntity.current_start * 1000) : undefined,
          currentPeriodEnd: subEntity.current_end ? new Date(subEntity.current_end * 1000) : undefined,
        },
      });

      await CacheService.del(CACHE_KEYS.USER_SUBSCRIPTION(subscription.userId));
    }
  }

  private static async handleSubscriptionHalted(payload: RazorpayWebhookPayload) {
    const subEntity = payload.payload.subscription?.entity;
    if (!subEntity) return;

    await prisma.subscription.updateMany({
      where: { razorpaySubscriptionId: subEntity.id },
      data: { status: 'HALTED' },
    });
  }
}
