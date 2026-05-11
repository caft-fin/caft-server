// ─────────────────────────────────────────────────────────
// CAFT Academy — Data Pool Routes
// ─────────────────────────────────────────────────────────

import { Router } from 'express';
import { DataPoolController } from '../controllers/dataPool.controller';
import { authenticate } from '../middleware/auth';
import { adminGuard } from '../middleware/adminAuth';

const router = Router();

// ── Public Routes ────────────────────────────────────────

// List all published courses
router.get('/courses', DataPoolController.listCourses);

// Optional auth: Get course by ID or Slug
router.get('/course/:courseId', authenticate, DataPoolController.getCourse);
router.get('/course/slug/:slug', authenticate, DataPoolController.getCourseBySlug);

// ── User Authenticated Routes ────────────────────────────

// User dashboard
router.get('/user/dashboard', authenticate, DataPoolController.getUserDashboard);

// Video streaming and progress
router.get('/video/:videoId/stream', authenticate, DataPoolController.getVideoStream);
router.post('/video/:videoId/progress', authenticate, DataPoolController.updateProgress);
router.post('/video/:videoId/event', authenticate, DataPoolController.trackEvent);

// Feedback
router.post('/course/:courseId/feedback', authenticate, DataPoolController.submitFeedback);

// ── Admin Routes ─────────────────────────────────────────

// Admin: Upload media
router.post('/admin/upload', authenticate, adminGuard, DataPoolController.getUploadUrl);

// Admin: Courses
router.post('/admin/courses', authenticate, adminGuard, DataPoolController.createCourse);

// Admin: Analytics
router.get('/admin/analytics/platform', authenticate, adminGuard, DataPoolController.getPlatformMetrics);
router.get('/admin/analytics/export', authenticate, adminGuard, DataPoolController.exportAnalyticsCsv);
router.get('/admin/analytics/video/:videoId', authenticate, adminGuard, DataPoolController.getVideoAnalytics);
router.get('/admin/analytics/course/:courseId/users', authenticate, adminGuard, DataPoolController.getCourseUserAnalytics);
router.get('/admin/analytics/user/:userId/history', authenticate, adminGuard, DataPoolController.getUserWatchHistory);

// Admin: Nudge & Aggregation
router.get('/admin/nudge/inactive', authenticate, adminGuard, DataPoolController.getInactiveUsers);
router.get('/admin/nudge/close-to-completion', authenticate, adminGuard, DataPoolController.getCloseToCompletion);
router.post('/admin/nudge/send', authenticate, adminGuard, DataPoolController.sendNudge);
router.post('/admin/analytics/aggregate', authenticate, adminGuard, DataPoolController.triggerAggregation);

export default router;
