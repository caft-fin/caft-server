// ─────────────────────────────────────────────────────────
// CAFT Financial — Email Campaign Routes (Admin)
// ─────────────────────────────────────────────────────────

import { Router } from 'express';
import { EmailController } from '../controllers/email.controller';
import { authenticate } from '../middleware/auth';
import { adminGuard } from '../middleware/adminAuth';

const router = Router();

router.use(authenticate, adminGuard);

// Campaigns
router.get('/campaigns', EmailController.getCampaigns);
router.post('/campaigns', EmailController.createCampaign);
router.put('/campaigns/:id', EmailController.updateCampaign);
router.post('/campaigns/:id/send', EmailController.sendCampaign);
router.post('/campaigns/:id/pause', EmailController.pauseCampaign);
router.get('/campaigns/:id/stats', EmailController.getCampaignStats);

// Templates
router.get('/templates', EmailController.getTemplates);
router.post('/templates', EmailController.createTemplate);
router.put('/templates/:id', EmailController.updateTemplate);
router.delete('/templates/:id', EmailController.deleteTemplate);

export default router;
