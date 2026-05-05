// ─────────────────────────────────────────────────────────
// CAFT Financial — Plan Controller (Admin CRUD + Bundles)
// ─────────────────────────────────────────────────────────

import { Request, Response, NextFunction } from 'express';
import { PlanService } from '../services/plan.service';
import { ApiResponse } from '../utils/apiResponse';
import { createPlanSchema, updatePlanSchema, createBundleSchema, updateBundleSchema } from '../utils/validators';
import { AuthenticatedRequest } from '../types';
import { prisma } from '../config/database';

export class PlanController {
  // ── Plan CRUD ──────────────────────────────────────────

  /** GET /api/plans — Public: list active plans */
  static async getActivePlans(_req: Request, res: Response, next: NextFunction) {
    try {
      const plans = await PlanService.getActivePlans();
      ApiResponse.success(res, plans);
    } catch (error) { next(error); }
  }

  /** GET /api/plans/admin — Admin: list all plans */
  static async getAllPlans(_req: Request, res: Response, next: NextFunction) {
    try {
      const plans = await PlanService.getAllPlans();
      ApiResponse.success(res, plans);
    } catch (error) { next(error); }
  }

  /** GET /api/plans/admin/:id — Admin: get single plan */
  static async getPlanById(req: Request, res: Response, next: NextFunction) {
    try {
      const plan = await PlanService.getPlanById(req.params.id as string);
      ApiResponse.success(res, plan);
    } catch (error) { next(error); }
  }

  /** POST /api/plans/admin — Admin: create plan */
  static async createPlan(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const input = createPlanSchema.parse(req.body);
      const plan = await PlanService.createPlan(input);

      // Audit log
      await prisma.auditLog.create({
        data: {
          userId: req.user?.userId,
          action: 'CREATE',
          entity: 'Plan',
          entityId: plan.id,
          details: JSON.stringify({ name: plan.name, planType: plan.planType }),
        },
      });

      ApiResponse.created(res, plan, 'Plan created successfully');
    } catch (error) { next(error); }
  }

  /** PUT /api/plans/admin/:id — Admin: update plan */
  static async updatePlan(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const input = updatePlanSchema.parse(req.body);
      const plan = await PlanService.updatePlan(req.params.id as string, input);

      await prisma.auditLog.create({
        data: {
          userId: req.user?.userId,
          action: 'UPDATE',
          entity: 'Plan',
          entityId: plan.id,
          details: JSON.stringify(input),
        },
      });

      ApiResponse.success(res, plan, 'Plan updated successfully');
    } catch (error) { next(error); }
  }

  /** POST /api/plans/admin/:id/duplicate — Admin: duplicate plan */
  static async duplicatePlan(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const plan = await PlanService.duplicatePlan(req.params.id as string);

      await prisma.auditLog.create({
        data: {
          userId: req.user?.userId,
          action: 'DUPLICATE',
          entity: 'Plan',
          entityId: plan.id,
          details: JSON.stringify({ sourceId: req.params.id }),
        },
      });

      ApiResponse.created(res, plan, 'Plan duplicated successfully');
    } catch (error) { next(error); }
  }

  /** DELETE /api/plans/admin/:id — Admin: delete plan */
  static async deletePlan(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await PlanService.deletePlan(req.params.id as string);

      await prisma.auditLog.create({
        data: {
          userId: req.user?.userId,
          action: 'DELETE',
          entity: 'Plan',
          entityId: req.params.id as string,
        },
      });

      ApiResponse.success(res, result, 'Plan deleted successfully');
    } catch (error) { next(error); }
  }

  /** POST /api/plans/admin/sync-razorpay — Admin: sync unsynced pricing to Razorpay */
  static async syncRazorpayPlans(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { planId } = req.body || {};
      const result = await PlanService.syncRazorpayPlans(planId);

      await prisma.auditLog.create({
        data: {
          userId: req.user?.userId,
          action: 'SYNC_RAZORPAY',
          entity: 'Plan',
          entityId: planId || 'all',
          details: JSON.stringify(result),
        },
      });

      ApiResponse.success(res, result, `Synced ${result.synced} plans with Razorpay`);
    } catch (error) { next(error); }
  }

  /** POST /api/plans/admin/bulk-discount — Admin: apply discount to multiple plans */
  static async bulkApplyDiscount(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { planIds, discountPercent, discountLabel } = req.body;
      const result = await PlanService.bulkApplyDiscount(planIds, discountPercent, discountLabel);

      await prisma.auditLog.create({
        data: {
          userId: req.user?.userId,
          action: 'BULK_DISCOUNT',
          entity: 'Plan',
          details: JSON.stringify({ planIds, discountPercent, discountLabel }),
        },
      });

      ApiResponse.success(res, result);
    } catch (error) { next(error); }
  }

  /** DELETE /api/plans/admin/bulk-discount — Admin: remove discount from multiple plans */
  static async bulkRemoveDiscount(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { planIds } = req.body;
      const result = await PlanService.bulkRemoveDiscount(planIds);
      ApiResponse.success(res, result);
    } catch (error) { next(error); }
  }

  // ── Bundle CRUD ────────────────────────────────────────

  /** GET /api/plans/bundles — Public: list active bundles */
  static async getActiveBundles(_req: Request, res: Response, next: NextFunction) {
    try {
      const bundles = await PlanService.getActiveBundles();
      ApiResponse.success(res, bundles);
    } catch (error) { next(error); }
  }

  /** GET /api/plans/admin/bundles — Admin: list all bundles */
  static async getAllBundles(_req: Request, res: Response, next: NextFunction) {
    try {
      const bundles = await PlanService.getAllBundles();
      ApiResponse.success(res, bundles);
    } catch (error) { next(error); }
  }

  /** POST /api/plans/admin/bundles — Admin: create bundle */
  static async createBundle(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const input = createBundleSchema.parse(req.body);
      const bundle = await PlanService.createBundle(input);

      await prisma.auditLog.create({
        data: {
          userId: req.user?.userId,
          action: 'CREATE',
          entity: 'PlanBundle',
          entityId: bundle.id,
          details: JSON.stringify({ name: bundle.name }),
        },
      });

      ApiResponse.created(res, bundle, 'Bundle created successfully');
    } catch (error) { next(error); }
  }

  /** PUT /api/plans/admin/bundles/:id — Admin: update bundle */
  static async updateBundle(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const input = updateBundleSchema.parse(req.body) as any;
      const bundle = await PlanService.updateBundle(req.params.id as string, input);

      await prisma.auditLog.create({
        data: {
          userId: req.user?.userId,
          action: 'UPDATE',
          entity: 'PlanBundle',
          entityId: bundle.id,
          details: JSON.stringify(input),
        },
      });

      ApiResponse.success(res, bundle, 'Bundle updated successfully');
    } catch (error) { next(error); }
  }

  /** DELETE /api/plans/admin/bundles/:id — Admin: delete bundle */
  static async deleteBundle(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const result = await PlanService.deleteBundle(req.params.id as string);

      await prisma.auditLog.create({
        data: {
          userId: req.user?.userId,
          action: 'DELETE',
          entity: 'PlanBundle',
          entityId: req.params.id as string,
        },
      });

      ApiResponse.success(res, result, 'Bundle deleted successfully');
    } catch (error) { next(error); }
  }
}
