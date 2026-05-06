// ─────────────────────────────────────────────────────────
// CAFT Financial — Purchase Routes
// ─────────────────────────────────────────────────────────

import { Router } from 'express';
import { PurchaseController } from '../controllers/purchase.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.post('/create', PurchaseController.create);
router.post('/verify', PurchaseController.verify);
router.get('/my-purchases', PurchaseController.getMyPurchases);
router.get('/my-access', PurchaseController.getMyAccess);

export default router;
