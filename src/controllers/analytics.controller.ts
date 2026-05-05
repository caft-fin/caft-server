// ─────────────────────────────────────────────────────────
// CAFT Financial — Analytics Controller
// ─────────────────────────────────────────────────────────

import { Request, Response, NextFunction } from 'express';
import { AnalyticsService } from '../services/analytics.service';
import { ApiResponse } from '../utils/apiResponse';

export class AnalyticsController {
  /** GET /api/admin/analytics/subscriptions — Subscription overview */
  static async getSubscriptionAnalytics(_req: Request, res: Response, next: NextFunction) {
    try {
      const data = await AnalyticsService.getSubscriptionOverview();
      ApiResponse.success(res, data);
    } catch (error) { next(error); }
  }

  /** GET /api/admin/analytics/revenue — Revenue breakdown */
  static async getRevenueAnalytics(_req: Request, res: Response, next: NextFunction) {
    try {
      const data = await AnalyticsService.getRevenueAnalytics();
      ApiResponse.success(res, data);
    } catch (error) { next(error); }
  }

  /** GET /api/admin/analytics/churn — Churn metrics */
  static async getChurnAnalytics(_req: Request, res: Response, next: NextFunction) {
    try {
      const data = await AnalyticsService.getChurnAnalytics();
      ApiResponse.success(res, data);
    } catch (error) { next(error); }
  }

  /** GET /api/admin/analytics/growth — Growth trends */
  static async getGrowthAnalytics(_req: Request, res: Response, next: NextFunction) {
    try {
      const data = await AnalyticsService.getGrowthAnalytics();
      ApiResponse.success(res, data);
    } catch (error) { next(error); }
  }

  /** GET /api/admin/analytics/rates — Subscription rates at all frequencies */
  static async getSubscriptionRates(_req: Request, res: Response, next: NextFunction) {
    try {
      const data = await AnalyticsService.getSubscriptionRates();
      ApiResponse.success(res, data);
    } catch (error) { next(error); }
  }

  /** GET /api/admin/analytics/payment-issues — Failed payments & abandoned carts with user details */
  static async getPaymentIssues(_req: Request, res: Response, next: NextFunction) {
    try {
      const data = await AnalyticsService.getPaymentIssues();
      ApiResponse.success(res, data);
    } catch (error) { next(error); }
  }
}
