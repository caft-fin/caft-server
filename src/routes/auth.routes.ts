// ─────────────────────────────────────────────────────────
// CAFT Financial — Auth Routes
// ─────────────────────────────────────────────────────────

import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth';
import { authLimiter } from '../middleware/rateLimiter';

const router = Router();

router.post('/login', authLimiter, AuthController.login);
router.post('/verify-otp', authLimiter, AuthController.verifyOtp);
router.post('/admin/login', authLimiter, AuthController.adminLogin);
router.post('/refresh', AuthController.refresh);
router.post('/logout', authenticate, AuthController.logout);

export default router;
