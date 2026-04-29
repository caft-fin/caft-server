// ─────────────────────────────────────────────────────────
// CAFT Financial — Subscription Controller
// ─────────────────────────────────────────────────────────

import { Response, NextFunction } from 'express';
import { SubscriptionService } from '../services/subscription.service';
import { ApiResponse } from '../utils/apiResponse';
import { AuthenticatedRequest } from '../types';
import { createSubscriptionSchema } from '../utils/validators';

export class SubscriptionController {
  static async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { planId, billingCycle } = createSubscriptionSchema.parse(req.body);
      const result = await SubscriptionService.createSubscription(req.user!.userId, planId, billingCycle);
      ApiResponse.created(res, result, 'Subscription created');
    } catch (error) { next(error); }
  }

  static async verify(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature } = req.body;
      const result = await SubscriptionService.verifyPayment(
        req.user!.userId, razorpay_payment_id, razorpay_subscription_id, razorpay_signature
      );
      ApiResponse.success(res, result, 'Payment verified');
    } catch (error) { next(error); }
  }

  static async getActive(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const subscription = await SubscriptionService.getActiveSubscription(req.user!.userId);
      ApiResponse.success(res, subscription);
    } catch (error) { next(error); }
  }

  static async cancel(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await SubscriptionService.cancelSubscription(req.user!.userId, req.body.reason);
      ApiResponse.success(res, result);
    } catch (error) { next(error); }
  }

  static async upgrade(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { planId, billingCycle } = createSubscriptionSchema.parse(req.body);
      const result = await SubscriptionService.upgradeSubscription(req.user!.userId, planId, billingCycle);
      ApiResponse.success(res, result, 'Subscription upgraded');
    } catch (error) { next(error); }
  }
}
