// ─────────────────────────────────────────────────────────
// CAFT Financial — Plan Routes (Plans + Bundles)
// ─────────────────────────────────────────────────────────

import { Router } from 'express';
import { PlanController } from '../controllers/plan.controller';
import { authenticate } from '../middleware/auth';
import { adminGuard } from '../middleware/adminAuth';

const router = Router();

// Public
router.get('/', PlanController.getActivePlans);
router.get('/bundles', PlanController.getActiveBundles);

// Admin — Plans
router.get('/admin', authenticate, adminGuard, PlanController.getAllPlans);
router.get('/admin/:id', authenticate, adminGuard, PlanController.getPlanById);
router.post('/admin', authenticate, adminGuard, PlanController.createPlan);
router.put('/admin/:id', authenticate, adminGuard, PlanController.updatePlan);
router.post('/admin/:id/duplicate', authenticate, adminGuard, PlanController.duplicatePlan);
router.delete('/admin/:id', authenticate, adminGuard, PlanController.deletePlan);

// Admin — Bulk discount
router.post('/admin/bulk-discount', authenticate, adminGuard, PlanController.bulkApplyDiscount);
router.delete('/admin/bulk-discount', authenticate, adminGuard, PlanController.bulkRemoveDiscount);

// Admin — Bundles
router.get('/admin/bundles', authenticate, adminGuard, PlanController.getAllBundles);
router.post('/admin/bundles', authenticate, adminGuard, PlanController.createBundle);
router.put('/admin/bundles/:id', authenticate, adminGuard, PlanController.updateBundle);
router.delete('/admin/bundles/:id', authenticate, adminGuard, PlanController.deleteBundle);

export default router;
