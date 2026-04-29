// ─────────────────────────────────────────────────────────
// CAFT Financial — Plan Controller (Admin CRUD)
// ─────────────────────────────────────────────────────────

import { Request, Response, NextFunction } from 'express';
import { PlanService } from '../services/plan.service';
import { ApiResponse } from '../utils/apiResponse';
import { createPlanSchema, updatePlanSchema, updatePricingSchema, updateFeaturesSchema } from '../utils/validators';
import { AuthenticatedRequest } from '../types';
import { prisma } from '../config/database';

export class PlanController {
  /** GET /api/plans — Public: list active plans */
  static async getActivePlans(_req: Request, res: Response, next: NextFunction) {
    try {
      const plans = await PlanService.getActivePlans();
      ApiResponse.success(res, plans);
    } catch (error) { next(error); }
  }

  /** GET /api/admin/plans — Admin: list all plans */
  static async getAllPlans(_req: Request, res: Response, next: NextFunction) {
    try {
      const plans = await PlanService.getAllPlans();
      ApiResponse.success(res, plans);
    } catch (error) { next(error); }
  }

  /** GET /api/admin/plans/:id — Admin: get single plan */
  static async getPlanById(req: Request, res: Response, next: NextFunction) {
    try {
      const plan = await PlanService.getPlanById(req.params.id as string);
      ApiResponse.success(res, plan);
    } catch (error) { next(error); }
  }

  /** POST /api/admin/plans — Admin: create plan */
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
          details: JSON.stringify({ name: plan.name, priceMonthly: plan.priceMonthly, priceYearly: plan.priceYearly }),
        },
      });

      ApiResponse.created(res, plan, 'Plan created successfully');
    } catch (error) { next(error); }
  }

  /** PUT /api/admin/plans/:id — Admin: update plan */
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

  /** PATCH /api/admin/plans/:id/pricing — Admin: update pricing */
  static async updatePricing(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { priceMonthly, priceYearly } = updatePricingSchema.parse(req.body);
      const plan = await PlanService.updatePricing(req.params.id as string, priceMonthly, priceYearly);

      await prisma.auditLog.create({
        data: {
          userId: req.user?.userId,
          action: 'UPDATE_PRICING',
          entity: 'Plan',
          entityId: plan.id,
          details: JSON.stringify({ priceMonthly, priceYearly }),
        },
      });

      ApiResponse.success(res, plan, 'Pricing updated successfully');
    } catch (error) { next(error); }
  }

  /** PATCH /api/admin/plans/:id/features — Admin: update features */
  static async updateFeatures(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { features } = updateFeaturesSchema.parse(req.body);
      const plan = await PlanService.updateFeatures(req.params.id as string, features);

      await prisma.auditLog.create({
        data: {
          userId: req.user?.userId,
          action: 'UPDATE_FEATURES',
          entity: 'Plan',
          entityId: plan.id,
          details: JSON.stringify({ featuresCount: features.length }),
        },
      });

      ApiResponse.success(res, plan, 'Features updated successfully');
    } catch (error) { next(error); }
  }

  /** DELETE /api/admin/plans/:id — Admin: delete plan */
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
}
