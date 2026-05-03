// ─────────────────────────────────────────────────────────
// CAFT Financial — Review Service
// ─────────────────────────────────────────────────────────

import { prisma } from '../config/database';
import { AppError } from '../utils/apiResponse';
import { CreateReviewInput, UpdateReviewInput } from '../types';

export class ReviewService {
  /**
   * Get all reviews for a specific plan
   */
  static async getReviewsByPlanId(planId: string) {
    return prisma.review.findMany({
      where: { planId, status: 'APPROVED' },
      include: {
        user: { select: { id: true, name: true, avatarUrl: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get all reviews (Admin)
   */
  static async getAllReviews() {
    return prisma.review.findMany({
      include: {
        plan: { select: { id: true, name: true } },
        user: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Calculate average rating for a plan
   */
  static async getPlanAverageRating(planId: string) {
    const aggregate = await prisma.review.aggregate({
      where: { planId, status: 'APPROVED' },
      _avg: { rating: true },
      _count: { rating: true },
    });

    return {
      average: aggregate._avg.rating || 0,
      count: aggregate._count.rating || 0,
    };
  }

  /**
   * Create a review
   */
  static async createReview(userId: string, input: CreateReviewInput) {
    // Optional: Check if user actually purchased this plan
    // For now, allow any authenticated user to leave a review
    
    // Check if user already reviewed this plan
    const existing = await prisma.review.findFirst({
      where: { userId, planId: input.planId },
    });
    
    if (existing) {
      throw new AppError('You have already reviewed this product', 400);
    }

    return prisma.review.create({
      data: {
        userId,
        planId: input.planId,
        rating: input.rating,
        comment: input.comment,
        status: 'APPROVED', // Default to approved for testing
      },
    });
  }

  /**
   * Update a review (Admin moderation)
   */
  static async updateReview(id: string, input: UpdateReviewInput) {
    const existing = await prisma.review.findUnique({ where: { id } });
    if (!existing) throw new AppError('Review not found', 404);

    return prisma.review.update({
      where: { id },
      data: {
        rating: input.rating !== undefined ? input.rating : existing.rating,
        comment: input.comment !== undefined ? input.comment : existing.comment,
        status: input.status !== undefined ? input.status : existing.status,
      },
    });
  }

  /**
   * Delete a review
   */
  static async deleteReview(id: string) {
    const existing = await prisma.review.findUnique({ where: { id } });
    if (!existing) throw new AppError('Review not found', 404);

    return prisma.review.delete({ where: { id } });
  }
}
