// ─────────────────────────────────────────────────────────
// CAFT Academy — Data Pool Controller
// Unified API layer for the course platform
// ─────────────────────────────────────────────────────────

import { Request, Response, NextFunction } from 'express';
import { DataPoolService } from '../services/dataPool.service';
import { CourseAnalyticsService } from '../services/courseAnalytics.service';
import { CourseMediaService } from '../services/courseMedia.service';
import { AuthenticatedRequest } from '../types';
import { z } from 'zod';

// ── Validation Schemas ───────────────────────────────────

const progressSchema = z.object({
  watchedSeconds: z.number().min(0),
  resumePositionSeconds: z.number().min(0),
  completionPercentage: z.number().min(0).max(100),
});

const eventSchema = z.object({
  eventType: z.enum([
    'PLAY', 'PAUSE', 'SEEK', 'FAST_FORWARD', 'REWIND',
    'SKIP_SECTION', 'COMPLETE', 'EXIT', 'REPLAY',
  ]),
  positionSeconds: z.number().min(0),
  metadata: z.record(z.any()).optional(),
});

const feedbackSchema = z.object({
  rating: z.number().int().min(1).max(5),
  reviewText: z.string().max(2000).optional(),
});

const courseUploadSchema = z.object({
  courseId: z.string().uuid(),
  folder: z.enum(['thumbnails', 'preview_videos', 'full_videos', 'certificates']),
  filename: z.string().min(1),
  contentType: z.string().min(1),
});

export class DataPoolController {
  // ═══════════════════════════════════════════════════════
  // COURSE ENDPOINTS
  // ═══════════════════════════════════════════════════════

  /**
   * GET /api/dp/courses
   * List all published courses
   */
  static async listCourses(req: Request, res: Response, next: NextFunction) {
    try {
      const difficulty = req.query.difficulty as string | undefined;
      const isFeatured = req.query.featured === 'true' ? true : undefined;
      const courses = await DataPoolService.listCourses({ difficulty, isFeatured });
      res.json({ success: true, data: courses });
    } catch (error) { next(error); }
  }

  /**
   * POST /api/dp/admin/courses
   * Admin: Create a new course
   */
  static async createCourse(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { title, description, price, difficulty } = req.body;
      const course = await DataPoolService.createCourse({ title, description, price, difficulty });
      res.status(201).json({ success: true, data: course });
    } catch (error) { next(error); }
  }

  /**
   * GET /api/dp/course/:courseId
   * Full course data with sections, videos, progress, enrollment
   */
  static async getCourse(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const courseId = req.params.courseId as string;
      const userId = req.user?.userId; // May be undefined for unauthenticated users
      const data = await DataPoolService.getCourseData(courseId, userId);
      res.json({ success: true, data });
    } catch (error) { next(error); }
  }

  /**
   * GET /api/dp/course/slug/:slug
   * Get course by slug
   */
  static async getCourseBySlug(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const slug = req.params.slug as string;
      const { prisma } = await import('../config/database');
      const course = await prisma.course.findUnique({
        where: { slug },
        select: { id: true },
      });
      if (!course) {
        return res.status(404).json({ success: false, message: 'Course not found' });
      }
      const userId = req.user?.userId;
      const data = await DataPoolService.getCourseData(course.id, userId);
      res.json({ success: true, data });
    } catch (error) { next(error); }
  }

  // ═══════════════════════════════════════════════════════
  // USER DASHBOARD
  // ═══════════════════════════════════════════════════════

  /**
   * GET /api/dp/user/dashboard
   * User's learning dashboard — enrolled courses, progress, badges
   */
  static async getUserDashboard(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const data = await DataPoolService.getUserDashboard(userId);
      res.json({ success: true, data });
    } catch (error) { next(error); }
  }

  // ═══════════════════════════════════════════════════════
  // VIDEO STREAMING & PROGRESS
  // ═══════════════════════════════════════════════════════

  /**
   * GET /api/dp/video/:videoId/stream
   * Secure video stream URL with access validation
   */
  static async getVideoStream(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const videoId = req.params.videoId as string;
      const userId = req.user!.userId;
      const data = await DataPoolService.getVideoStream(videoId, userId);
      res.json({ success: true, data });
    } catch (error) { next(error); }
  }

  /**
   * POST /api/dp/video/:videoId/progress
   * Upsert video watching progress (called every ~10 seconds)
   */
  static async updateProgress(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const videoId = req.params.videoId as string;
      const userId = req.user!.userId;
      const body = progressSchema.parse(req.body);
      const result = await DataPoolService.updateVideoProgress(videoId, userId, body);
      res.json({ success: true, data: result });
    } catch (error) { next(error); }
  }

  /**
   * POST /api/dp/video/:videoId/event
   * Fire-and-forget video event tracking
   */
  static async trackEvent(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const videoId = req.params.videoId as string;
      const userId = req.user!.userId;
      const body = eventSchema.parse(req.body);
      const result = await DataPoolService.trackVideoEvent(videoId, userId, body);
      res.json({ success: true, data: result });
    } catch (error) { next(error); }
  }

  // ═══════════════════════════════════════════════════════
  // FEEDBACK
  // ═══════════════════════════════════════════════════════

  /**
   * POST /api/dp/course/:courseId/feedback
   * Submit course rating and review
   */
  static async submitFeedback(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const courseId = req.params.courseId as string;
      const userId = req.user!.userId;
      const body = feedbackSchema.parse(req.body);

      const { prisma } = await import('../config/database');
      const feedback = await prisma.courseFeedback.upsert({
        where: { userId_courseId: { userId, courseId } },
        create: { userId, courseId, rating: body.rating, reviewText: body.reviewText },
        update: { rating: body.rating, reviewText: body.reviewText, submittedAt: new Date() },
      });

      res.json({ success: true, data: feedback });
    } catch (error) { next(error); }
  }

  // ═══════════════════════════════════════════════════════
  // MEDIA UPLOADS (Admin)
  // ═══════════════════════════════════════════════════════

  /**
   * POST /api/dp/admin/upload
   * Generate presigned upload URL for course media
   */
  static async getUploadUrl(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const body = courseUploadSchema.parse(req.body);
      const result = await CourseMediaService.getUploadUrl(
        body.courseId, body.folder, body.filename, body.contentType
      );
      res.json({ success: true, data: result });
    } catch (error) { next(error); }
  }

  // ═══════════════════════════════════════════════════════
  // ADMIN ANALYTICS
  // ═══════════════════════════════════════════════════════

  /**
   * GET /api/dp/admin/analytics/video/:videoId
   * Detailed per-video analytics
   */
  static async getVideoAnalytics(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const videoId = req.params.videoId as string;
      const data = await CourseAnalyticsService.getVideoAnalytics(videoId);
      if (!data) return res.status(404).json({ success: false, message: 'Video not found' });
      res.json({ success: true, data });
    } catch (error) { next(error); }
  }

  /**
   * GET /api/dp/admin/analytics/course/:courseId/users
   * Per-user analytics for a specific course
   */
  static async getCourseUserAnalytics(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const courseId = req.params.courseId as string;
      const data = await CourseAnalyticsService.getCourseUserAnalytics(courseId);
      res.json({ success: true, data });
    } catch (error) { next(error); }
  }

  /**
   * GET /api/dp/admin/analytics/platform
   * Platform-wide metrics
   */
  static async getPlatformMetrics(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const data = await CourseAnalyticsService.getPlatformMetrics();
      res.json({ success: true, data });
    } catch (error) { next(error); }
  }

  /**
   * GET /api/dp/admin/analytics/export
   * Export platform metrics as CSV
   */
  static async exportAnalyticsCsv(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const csvString = await CourseAnalyticsService.getAnalyticsCsv();
      res.header('Content-Type', 'text/csv');
      res.attachment(`caft-analytics-${new Date().toISOString().split('T')[0]}.csv`);
      res.send(csvString);
    } catch (error) { next(error); }
  }

  /**
   * GET /api/dp/admin/analytics/user/:userId/history
   * Full watch history for a specific user (admin view)
   */
  static async getUserWatchHistory(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.params.userId as string;
      const data = await CourseAnalyticsService.getUserWatchHistory(userId);
      res.json({ success: true, data });
    } catch (error) { next(error); }
  }

  /**
   * GET /api/dp/admin/nudge/inactive
   * Users inactive for 7+ days
   */
  static async getInactiveUsers(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const days = parseInt(req.query.days as string) || 7;
      const data = await CourseAnalyticsService.getInactiveUsers(days);
      res.json({ success: true, data });
    } catch (error) { next(error); }
  }

  /**
   * GET /api/dp/admin/nudge/close-to-completion
   * Users who are close to completing a course
   */
  static async getCloseToCompletion(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const threshold = parseInt(req.query.threshold as string) || 80;
      const data = await CourseAnalyticsService.getCloseToCompletionUsers(threshold);
      res.json({ success: true, data });
    } catch (error) { next(error); }
  }

  /**
   * POST /api/dp/admin/analytics/aggregate
   * Manually trigger analytics aggregation
   */
  static async triggerAggregation(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      await CourseAnalyticsService.runAggregationJob();
      res.json({ success: true, message: 'Aggregation completed' });
    } catch (error) { next(error); }
  }
  /**
   * POST /api/dp/admin/nudge/send
   * Send a nudge email to specific users
   */
  static async sendNudge(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { userIds, subject, message } = z.object({
        userIds: z.array(z.string()),
        subject: z.string().min(1),
        message: z.string().min(1),
      }).parse(req.body);

      const result = await CourseAnalyticsService.sendNudgeEmails(userIds, subject, message);
      res.json({ success: true, ...result });
    } catch (error) { next(error); }
  }

  /**
   * GET /api/dp/admin/courses
   * Admin: List ALL courses (including unpublished)
   */
  static async listAllCourses(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const courses = await DataPoolService.listAllCourses();
      res.json({ success: true, data: courses });
    } catch (error) { next(error); }
  }

  /**
   * PUT /api/dp/admin/courses/:courseId
   * Admin: Update a course
   */
  static async updateCourse(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const courseId = req.params.courseId as string;
      const { title, description, price, difficulty, isPublished, isFeatured } = req.body;
      const course = await DataPoolService.updateCourse(courseId, { title, description, price, difficulty, isPublished, isFeatured });
      res.json({ success: true, data: course });
    } catch (error) { next(error); }
  }

  /**
   * DELETE /api/dp/admin/courses/:courseId
   * Admin: Delete a course
   */
  static async deleteCourse(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const courseId = req.params.courseId as string;
      const result = await DataPoolService.deleteCourse(courseId);
      res.json({ success: true, data: result });
    } catch (error) { next(error); }
  }
}
