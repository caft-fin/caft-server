// ─────────────────────────────────────────────────────────
// CAFT Financial — Plan Routes
// ─────────────────────────────────────────────────────────

import { Router } from 'express';
import { PlanController } from '../controllers/plan.controller';
import { authenticate } from '../middleware/auth';
import { adminGuard } from '../middleware/adminAuth';

const router = Router();

// Public
router.get('/', PlanController.getActivePlans);

// Admin CRUD
router.get('/admin', authenticate, adminGuard, PlanController.getAllPlans);
router.get('/admin/:id', authenticate, adminGuard, PlanController.getPlanById);
router.post('/admin', authenticate, adminGuard, PlanController.createPlan);
router.put('/admin/:id', authenticate, adminGuard, PlanController.updatePlan);
router.patch('/admin/:id/pricing', authenticate, adminGuard, PlanController.updatePricing);
router.patch('/admin/:id/features', authenticate, adminGuard, PlanController.updateFeatures);
router.delete('/admin/:id', authenticate, adminGuard, PlanController.deletePlan);

export default router;
