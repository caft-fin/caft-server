// ─────────────────────────────────────────────────────────
// CAFT Financial — Analytics Routes (Admin)
// ─────────────────────────────────────────────────────────

import { Router } from 'express';
import { AnalyticsController } from '../controllers/analytics.controller';
import { authenticate } from '../middleware/auth';
import { adminGuard } from '../middleware/adminAuth';

const router = Router();

router.use(authenticate, adminGuard);

router.get('/subscriptions', AnalyticsController.getSubscriptionAnalytics);
router.get('/revenue', AnalyticsController.getRevenueAnalytics);
router.get('/churn', AnalyticsController.getChurnAnalytics);
router.get('/growth', AnalyticsController.getGrowthAnalytics);
router.get('/rates', AnalyticsController.getSubscriptionRates);

export default router;
