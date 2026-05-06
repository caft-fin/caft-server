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

// Admin — Plans (non-parameterized routes FIRST)
router.get('/admin', authenticate, adminGuard, PlanController.getAllPlans);
router.post('/admin', authenticate, adminGuard, PlanController.createPlan);

// Admin — Bulk discount
router.post('/admin/bulk-discount', authenticate, adminGuard, PlanController.bulkApplyDiscount);
router.delete('/admin/bulk-discount', authenticate, adminGuard, PlanController.bulkRemoveDiscount);

// Admin — Sync Razorpay plans (retry failed syncs)
router.post('/admin/sync-razorpay', authenticate, adminGuard, PlanController.syncRazorpayPlans);

// Admin — Bundles
router.get('/admin/bundles', authenticate, adminGuard, PlanController.getAllBundles);
router.post('/admin/bundles', authenticate, adminGuard, PlanController.createBundle);
router.put('/admin/bundles/:id', authenticate, adminGuard, PlanController.updateBundle);
router.delete('/admin/bundles/:id', authenticate, adminGuard, PlanController.deleteBundle);

// Admin — Plan by ID (parameterized — MUST be last to avoid catching /admin/bundles etc.)
router.get('/admin/:id', authenticate, adminGuard, PlanController.getPlanById);
router.put('/admin/:id', authenticate, adminGuard, PlanController.updatePlan);
router.post('/admin/:id/duplicate', authenticate, adminGuard, PlanController.duplicatePlan);
router.delete('/admin/:id', authenticate, adminGuard, PlanController.deletePlan);

export default router;
