// ─────────────────────────────────────────────────────────
// CAFT Financial — Purchase Controller
// ─────────────────────────────────────────────────────────

import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import { PurchaseService } from '../services/purchase.service';
import { ApiResponse, AppError } from '../utils/apiResponse';

export class PurchaseController {
  /**
   * POST /purchases/create — Create a purchase (one-time or physical product)
   */
  static async create(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const { planId, quantity } = req.body;
      if (!planId) throw new AppError('Plan ID is required', 400);
      const result = await PurchaseService.createPurchase(userId, planId, quantity || 1);
      ApiResponse.success(res, result, 'Purchase created — proceed to payment');
    } catch (error) { next(error); }
  }

  /**
   * POST /purchases/verify — Verify purchase payment after checkout
   */
  static async verify(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const { razorpayPaymentId, razorpayOrderId, razorpaySignature, purchaseId } = req.body;
      if (!razorpayPaymentId || !razorpayOrderId || !razorpaySignature || !purchaseId) {
        throw new AppError('Payment ID, Order ID, Signature, and Purchase ID are required', 400);
      }
      const result = await PurchaseService.verifyPurchasePayment(
        userId, razorpayPaymentId, razorpayOrderId, razorpaySignature, purchaseId
      );
      ApiResponse.success(res, result);
    } catch (error) { next(error); }
  }

  /**
   * GET /purchases/my-purchases — Get all user purchases
   */
  static async getMyPurchases(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const purchases = await PurchaseService.getUserPurchases(userId);
      ApiResponse.success(res, purchases);
    } catch (error) { next(error); }
  }

  /**
   * GET /purchases/my-access — Get user's full access list (subscriptions + purchases)
   */
  static async getMyAccess(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const access = await PurchaseService.getUserAccess(userId);
      ApiResponse.success(res, access);
    } catch (error) { next(error); }
  }
}
