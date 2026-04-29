// ─────────────────────────────────────────────────────────
// CAFT Financial — User Routes
// ─────────────────────────────────────────────────────────

import { Router } from 'express';
import { UserController } from '../controllers/user.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(authenticate);

router.get('/me', UserController.getProfile);
router.put('/me', UserController.updateProfile);
router.get('/me/subscription', UserController.getSubscription);
router.get('/me/transactions', UserController.getTransactions);
router.get('/me/linked-accounts', UserController.getLinkedAccounts);
router.post('/me/linked-accounts', UserController.addLinkedAccount);
router.delete('/me/linked-accounts/:id', UserController.removeLinkedAccount);
router.get('/me/notifications', UserController.getNotificationPreferences);
router.put('/me/notifications', UserController.updateNotificationPreferences);
router.put('/me/security', UserController.updateSecurity);
router.delete('/me', UserController.deactivateAccount);

export default router;
