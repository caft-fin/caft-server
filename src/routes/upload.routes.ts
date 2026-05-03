// ─────────────────────────────────────────────────────────
// CAFT Financial — Upload Routes
// ─────────────────────────────────────────────────────────

import { Router } from 'express';
import { UploadController } from '../controllers/upload.controller';
import { authenticate } from '../middleware/auth';
import { adminGuard } from '../middleware/adminAuth';

const router = Router();

// Only admins can upload files
router.post('/presigned-url', authenticate, adminGuard, UploadController.getPresignedUrl);

export default router;
