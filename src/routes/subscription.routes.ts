// ─────────────────────────────────────────────────────────
// CAFT Financial — Subscription Routes
// ─────────────────────────────────────────────────────────

import { Router } from 'express';
import { SubscriptionController } from '../controllers/subscription.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.post('/create', SubscriptionController.create);
router.post('/verify', SubscriptionController.verify);
router.get('/active', SubscriptionController.getActive);
router.post('/cancel', SubscriptionController.cancel);
router.post('/upgrade', SubscriptionController.upgrade);

export default router;
