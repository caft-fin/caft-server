// ─────────────────────────────────────────────────────────
// CAFT Financial — Admin Routes
// ─────────────────────────────────────────────────────────

import { Router } from 'express';
import { AdminController } from '../controllers/admin.controller';
import { authenticate } from '../middleware/auth';
import { adminGuard, superAdminGuard } from '../middleware/adminAuth';

const router = Router();

// All admin routes require auth + admin role
router.use(authenticate, adminGuard);

// User management
router.get('/users', AdminController.getUsers);
router.get('/users/:id/details', AdminController.getUserDetails);  // Full user detail panel
router.post('/users', AdminController.createUser);            // Create user account
router.put('/users/:id', AdminController.updateUser);
router.delete('/users/:id', AdminController.deleteUser);

// Admin creation (SUPERADMIN ONLY)
router.post('/admins', superAdminGuard, AdminController.createAdmin);

// Dashboard stats
router.get('/stats/overview', AdminController.getStatsOverview);
router.get('/stats/revenue', AdminController.getRevenueStats);

// Settings
router.get('/settings', AdminController.getSettings);
router.put('/settings', AdminController.updateSettings);

// Danger Zone (SUPERADMIN ONLY) — full database inspection
router.get('/danger/tables', superAdminGuard, AdminController.listTables);
router.get('/danger/tables/:table', superAdminGuard, AdminController.getTableRecords);
router.delete('/danger/tables/:table/:id', superAdminGuard, AdminController.deleteRecord);

export default router;
