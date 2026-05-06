// ─────────────────────────────────────────────────────────
// CAFT Financial — Purchase Controller
// ─────────────────────────────────────────────────────────

import { Response } from 'express';
import { AuthenticatedRequest } from '../types';
import { PurchaseService } from '../services/purchase.service';
import { ApiResponse } from '../utils/apiResponse';

export class PurchaseController {
  /**
   * POST /purchases/create — Create a purchase (one-time or physical product)
   */
  static async create(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user!.userId;
      const { planId, quantity } = req.body;
      if (!planId) return ApiResponse.error(res, 'Plan ID is required', 400);
      const result = await PurchaseService.createPurchase(userId, planId, quantity || 1);
      ApiResponse.success(res, result, 'Purchase created — proceed to payment');
    } catch (err: any) {
      ApiResponse.error(res, err.message, err.statusCode || 500);
    }
  }

  /**
   * POST /purchases/verify — Verify purchase payment after checkout
   */
  static async verify(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user!.userId;
      const { razorpayPaymentId, razorpayOrderId, razorpaySignature, purchaseId } = req.body;
      if (!razorpayPaymentId || !razorpayOrderId || !razorpaySignature || !purchaseId) {
        return ApiResponse.error(res, 'Payment ID, Order ID, Signature, and Purchase ID are required', 400);
      }
      const result = await PurchaseService.verifyPurchasePayment(
        userId, razorpayPaymentId, razorpayOrderId, razorpaySignature, purchaseId
      );
      ApiResponse.success(res, result);
    } catch (err: any) {
      ApiResponse.error(res, err.message, err.statusCode || 500);
    }
  }

  /**
   * GET /purchases/my-purchases — Get all user purchases
   */
  static async getMyPurchases(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user!.userId;
      const purchases = await PurchaseService.getUserPurchases(userId);
      ApiResponse.success(res, purchases);
    } catch (err: any) {
      ApiResponse.error(res, err.message, err.statusCode || 500);
    }
  }

  /**
   * GET /purchases/my-access — Get user's full access list (subscriptions + purchases)
   */
  static async getMyAccess(req: AuthenticatedRequest, res: Response) {
    try {
      const userId = req.user!.userId;
      const access = await PurchaseService.getUserAccess(userId);
      ApiResponse.success(res, access);
    } catch (err: any) {
      ApiResponse.error(res, err.message, err.statusCode || 500);
    }
  }
}
