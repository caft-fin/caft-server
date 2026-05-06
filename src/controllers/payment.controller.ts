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

      // Webhook signature verification is MANDATORY
      if (!env.RAZORPAY_WEBHOOK_SECRET) {
        console.error('❌ RAZORPAY_WEBHOOK_SECRET is not configured — rejecting webhook');
        ApiResponse.serverError(res, 'Webhook signature verification is not configured');
        return;
      }

      if (!signature) {
        ApiResponse.unauthorized(res, 'Missing webhook signature header');
        return;
      }

      const isValid = verifyRazorpaySignature(body, signature, env.RAZORPAY_WEBHOOK_SECRET);
      if (!isValid) {
        ApiResponse.unauthorized(res, 'Invalid webhook signature');
        return;
      }

      await PaymentService.handleWebhook(req.body as RazorpayWebhookPayload);

      // Razorpay expects 200 OK
      res.status(200).json({ status: 'ok' });
    } catch (error) { next(error); }
  }
}
