// ─────────────────────────────────────────────────────────
// CAFT Financial — Review Controller
// ─────────────────────────────────────────────────────────

import { Request, Response, NextFunction } from 'express';
import { ReviewService } from '../services/review.service';
import { createReviewSchema, updateReviewSchema } from '../utils/validators';
import { AuthenticatedRequest } from '../types';
import { AppError } from '../utils/apiResponse';
import { prisma } from '../config/database';

export class ReviewController {
  /** GET /api/reviews/plan/:planId — Get all approved reviews for a plan */
  static async getPlanReviews(req: Request, res: Response, next: NextFunction) {
    try {
      const { planId } = req.params;
      const reviews = await ReviewService.getReviewsByPlanId(planId as string);
      const rating = await ReviewService.getPlanAverageRating(planId as string);
      
      res.json({
        status: 'success',
        data: {
          reviews,
          averageRating: rating.average,
          totalReviews: rating.count,
        },
      });
    } catch (error) { next(error); }
  }

  /** GET /api/reviews/admin — Admin: Get all reviews */
  static async getAllReviews(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const reviews = await ReviewService.getAllReviews();
      res.json({ status: 'success', data: reviews });
    } catch (error) { next(error); }
  }

  /** POST /api/reviews — User: Create a review */
  static async createReview(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const input = createReviewSchema.parse(req.body);
      const userId = req.user?.userId;
      if (!userId) throw new AppError('Unauthorized', 401);

      const review = await ReviewService.createReview(userId, input);
      
      res.status(201).json({
        status: 'success',
        data: review,
        message: 'Review submitted successfully',
      });
    } catch (error) { next(error); }
  }

  /** PUT /api/reviews/admin/:id — Admin: Moderate/Update a review */
  static async updateReview(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const input = updateReviewSchema.parse(req.body);
      const review = await ReviewService.updateReview(req.params.id as string, {
        ...input,
        comment: input.comment ?? undefined
      });

      // Audit log
      await prisma.auditLog.create({
        data: {
          userId: req.user?.userId,
          action: 'MODERATE_REVIEW',
          entity: 'Review',
          entityId: review.id,
          details: JSON.stringify(input),
        },
      });

      res.json({
        status: 'success',
        data: review,
        message: 'Review updated successfully',
      });
    } catch (error) { next(error); }
  }

  /** DELETE /api/reviews/admin/:id — Admin: Delete a review */
  static async deleteReview(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      await ReviewService.deleteReview(req.params.id as string);

      await prisma.auditLog.create({
        data: {
          userId: req.user?.userId,
          action: 'DELETE',
          entity: 'Review',
          entityId: req.params.id as string,
        },
      });

      res.json({
        status: 'success',
        message: 'Review deleted successfully',
      });
    } catch (error) { next(error); }
  }
}
