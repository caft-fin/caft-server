// ─────────────────────────────────────────────────────────
// CAFT Financial — Payment Routes
// ─────────────────────────────────────────────────────────

import { Router } from 'express';
import { PaymentController } from '../controllers/payment.controller';
import { authenticate } from '../middleware/auth';
import { webhookLimiter } from '../middleware/rateLimiter';

const router = Router();

// Webhook (public, verified by signature)
router.post('/webhooks/razorpay', webhookLimiter, PaymentController.webhook);

// Authenticated routes
router.get('/history', authenticate, PaymentController.getHistory);
router.get('/:id', authenticate, PaymentController.getById);

export default router;
