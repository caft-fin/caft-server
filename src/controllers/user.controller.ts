// ─────────────────────────────────────────────────────────
// CAFT Financial — User Controller
// ─────────────────────────────────────────────────────────

import { Response, NextFunction } from 'express';
import { UserService } from '../services/user.service';
import { SubscriptionService } from '../services/subscription.service';
import { ApiResponse } from '../utils/apiResponse';
import { AuthenticatedRequest } from '../types';
import { updateProfileSchema, updateNotificationPrefsSchema, updateSecuritySchema, addLinkedAccountSchema, paginationSchema } from '../utils/validators';
import { computePagination } from '../utils/helpers';

export class UserController {
  static async getProfile(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const profile = await UserService.getProfile(req.user!.userId);
      ApiResponse.success(res, profile);
    } catch (error) { next(error); }
  }

  static async updateProfile(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const data = updateProfileSchema.parse(req.body);
      const user = await UserService.updateProfile(req.user!.userId, data);
      ApiResponse.success(res, user, 'Profile updated');
    } catch (error) { next(error); }
  }

  static async getSubscription(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const subscription = await SubscriptionService.getActiveSubscription(req.user!.userId);
      ApiResponse.success(res, subscription);
    } catch (error) { next(error); }
  }

  static async getTransactions(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { page, limit } = paginationSchema.parse(req.query);
      const { transactions, total } = await UserService.getTransactions(req.user!.userId, page, limit);
      ApiResponse.paginated(res, transactions, computePagination(total, page, limit));
    } catch (error) { next(error); }
  }

  static async getLinkedAccounts(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const accounts = await UserService.getLinkedAccounts(req.user!.userId);
      ApiResponse.success(res, accounts);
    } catch (error) { next(error); }
  }

  static async addLinkedAccount(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const data = addLinkedAccountSchema.parse(req.body);
      const account = await UserService.addLinkedAccount(req.user!.userId, data);
      ApiResponse.created(res, account, 'Account linked');
    } catch (error) { next(error); }
  }

  static async removeLinkedAccount(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await UserService.removeLinkedAccount(req.user!.userId, req.params.id as string);
      ApiResponse.success(res, result);
    } catch (error) { next(error); }
  }

  static async getNotificationPreferences(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const prefs = await UserService.getNotificationPreferences(req.user!.userId);
      ApiResponse.success(res, prefs);
    } catch (error) { next(error); }
  }

  static async updateNotificationPreferences(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const data = updateNotificationPrefsSchema.parse(req.body);
      const prefs = await UserService.updateNotificationPreferences(req.user!.userId, data);
      ApiResponse.success(res, prefs, 'Preferences updated');
    } catch (error) { next(error); }
  }

  static async updateSecurity(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const data = updateSecuritySchema.parse(req.body);
      const result = await UserService.updateSecurity(req.user!.userId, data);
      ApiResponse.success(res, result, 'Security settings updated');
    } catch (error) { next(error); }
  }

  static async deactivateAccount(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await UserService.deactivateAccount(req.user!.userId);
      ApiResponse.success(res, result);
    } catch (error) { next(error); }
  }
}
