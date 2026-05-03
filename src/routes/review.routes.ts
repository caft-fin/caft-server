// ─────────────────────────────────────────────────────────
// CAFT Financial — Review Routes
// ─────────────────────────────────────────────────────────

import { Router } from 'express';
import { ReviewController } from '../controllers/review.controller';
import { authenticate } from '../middleware/auth';
import { adminGuard } from '../middleware/adminAuth';

const router = Router();

// Public routes
router.get('/plan/:planId', ReviewController.getPlanReviews);

// Protected user routes
router.post('/', authenticate, ReviewController.createReview);

// Admin routes
router.get('/admin', authenticate, adminGuard, ReviewController.getAllReviews);
router.put('/admin/:id', authenticate, adminGuard, ReviewController.updateReview);
router.delete('/admin/:id', authenticate, adminGuard, ReviewController.deleteReview);

export default router;
