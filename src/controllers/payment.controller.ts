// ─────────────────────────────────────────────────────────
// CAFT Financial — Payment Controller
// ─────────────────────────────────────────────────────────

import { Request, Response, NextFunction } from 'express';
import { PaymentService } from '../services/payment.service';
import { ApiResponse } from '../utils/apiResponse';
import { AuthenticatedRequest, RazorpayWebhookPayload } from '../types';
import { paginationSchema } from '../utils/validators';
import { computePagination, verifyRazorpaySignature } from '../utils/helpers';
import { env } from '../config/env';

export class PaymentController {
  static async getHistory(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { page, limit } = paginationSchema.parse(req.query);
      const { payments, total } = await PaymentService.getPaymentHistory(req.user!.userId, page, limit);
      ApiResponse.paginated(res, payments, computePagination(total, page, limit));
    } catch (error) { next(error); }
  }

  static async getById(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const payment = await PaymentService.getPaymentById(req.user!.userId, req.params.id as string);
      ApiResponse.success(res, payment);
    } catch (error) { next(error); }
  }

  /** Razorpay webhook handler — verifies signature then processes event */
  static async webhook(req: Request, res: Response, next: NextFunction) {
    try {
      const signature = req.headers['x-razorpay-signature'] as string | undefined;
      const body = (req as any).rawBody || JSON.stringify(req.body);
      const eventName = req.body?.event || 'unknown';

      console.log(`\n📨 Incoming Razorpay webhook: ${eventName}`);
      console.log(`   Signature present: ${!!signature}`);
      console.log(`   Body length: ${body.length} bytes`);

      // Webhook signature verification is MANDATORY
      if (!env.RAZORPAY_WEBHOOK_SECRET) {
        console.error('❌ RAZORPAY_WEBHOOK_SECRET is not configured — rejecting webhook');
        console.error('   ⚠️  Set RAZORPAY_WEBHOOK_SECRET in your .env / .env.prod file');
        console.error('   ⚠️  Generate it in: Razorpay Dashboard → Settings → Webhooks');
        ApiResponse.serverError(res, 'Webhook signature verification is not configured');
        return;
      }

      if (!signature) {
        console.error(`❌ Webhook ${eventName} rejected: missing x-razorpay-signature header`);
        ApiResponse.unauthorized(res, 'Missing webhook signature header');
        return;
      }

      const isValid = verifyRazorpaySignature(body, signature, env.RAZORPAY_WEBHOOK_SECRET);
      if (!isValid) {
        console.error(`❌ Webhook ${eventName} rejected: invalid signature`);
        console.error(`   Signature received: ${signature.substring(0, 16)}...`);
        ApiResponse.unauthorized(res, 'Invalid webhook signature');
        return;
      }

      console.log(`✅ Webhook ${eventName} signature verified — processing...`);
      await PaymentService.handleWebhook(req.body as RazorpayWebhookPayload);

      console.log(`✅ Webhook ${eventName} processed successfully\n`);

      // Razorpay expects 200 OK
      res.status(200).json({ status: 'ok' });
    } catch (error) {
      console.error(`❌ Webhook processing error:`, (error as Error).message);
      next(error);
    }
  }

  /**
   * GET /payments/config — Public endpoint to get Razorpay config
   * This ensures frontend always uses the same key as the backend,
   * eliminating key mismatch issues in production.
   */
  static async getConfig(_req: Request, res: Response) {
    res.json({
      success: true,
      data: {
        keyId: env.RAZORPAY_KEY_ID,
        appName: env.APP_NAME || 'CAFT Financial',
      },
    });
  }
}
