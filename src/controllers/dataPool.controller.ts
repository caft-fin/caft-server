// ─────────────────────────────────────────────────────────
// CAFT Academy — Data Pool Controller
// Unified API layer for the course platform
// ─────────────────────────────────────────────────────────

import { Request, Response, NextFunction } from 'express';
import { DataPoolService } from '../services/dataPool.service';
import { CourseAnalyticsService } from '../services/courseAnalytics.service';
import { CourseMediaService } from '../services/courseMedia.service';
import { AuthenticatedRequest } from '../types';
import { ApiResponse, AppError } from '../utils/apiResponse';
import { prisma } from '../config/database';
import { z } from 'zod';

// ── Validation Schemas ────────────────────────────────────

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

const createCourseSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  description: z.string().min(1, 'Description is required').max(5000),
  price: z.number().int().min(0, 'Price must be non-negative (paise)'),
  difficulty: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']),
});

const updateCourseSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(5000).optional(),
  price: z.number().int().min(0).optional(),
  difficulty: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']).optional(),
  isPublished: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
  thumbnailUrl: z.string().url().optional().nullable(),
  trailerUrl: z.string().url().optional().nullable(),
  trailerS3Key: z.string().max(500).optional().nullable(),
});

const createSectionSchema = z.object({
  courseId: z.string().uuid(),
  title: z.string().min(1).max(200),
  orderIndex: z.number().int().min(0).optional(),
});

const updateSectionSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  orderIndex: z.number().int().min(0).optional(),
});

const createVideoSchema = z.object({
  courseId: z.string().uuid(),
  sectionId: z.string().uuid(),
  title: z.string().min(1).max(300),
  description: z.string().max(5000).optional(),
  s3Key: z.string().min(1, 'S3 key is required'),
  durationSeconds: z.number().int().min(0).optional(),
  isPreview: z.boolean().default(false),
  previewDurationSeconds: z.number().int().min(0).optional(),
  orderIndex: z.number().int().min(0).optional(),
  thumbnailUrl: z.string().url().optional().nullable(),
});

const updateVideoSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().max(5000).optional().nullable(),
  durationSeconds: z.number().int().min(0).optional(),
  isPreview: z.boolean().optional(),
  previewDurationSeconds: z.number().int().min(0).optional(),
  previewStartSeconds: z.number().int().min(0).optional(),
  previewEndSeconds: z.number().int().min(0).optional().nullable(),
  orderIndex: z.number().int().min(0).optional(),
  isPublished: z.boolean().optional(),
  thumbnailUrl: z.string().url().optional().nullable(),
});

const sendNudgeSchema = z.object({
  userIds: z.array(z.string()).min(1, 'At least one user ID is required'),
  subject: z.string().min(1).max(200),
  message: z.string().min(1).max(5000),
});

// ── Controller ────────────────────────────────────────────

export class DataPoolController {
  // ═══════════════════════════════════════════════════════
  // COURSE ENDPOINTS
  // ═══════════════════════════════════════════════════════

  /** GET /api/dp/courses — List all published courses */
  static async listCourses(req: Request, res: Response, next: NextFunction) {
    try {
      const difficulty = req.query.difficulty as string | undefined;
      const isFeatured = req.query.featured === 'true' ? true : undefined;
      const courses = await DataPoolService.listCourses({ difficulty, isFeatured });
      ApiResponse.success(res, courses);
    } catch (error) { next(error); }
  }

  /** POST /api/dp/admin/courses — Admin: Create a new course */
  static async createCourse(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const body = createCourseSchema.parse(req.body);
      const course = await DataPoolService.createCourse(body);
      ApiResponse.created(res, course, 'Course created');
    } catch (error) { next(error); }
  }

  /** GET /api/dp/course/:courseId — Full course data with sections, videos, progress */
  static async getCourse(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const courseId = req.params.courseId as string;
      const userId = req.user?.userId;
      const data = await DataPoolService.getCourseData(courseId, userId);
      ApiResponse.success(res, data);
    } catch (error) { next(error); }
  }

  /** GET /api/dp/course/slug/:slug — Get course by slug */
  static async getCourseBySlug(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const slug = req.params.slug as string;
      const course = await prisma.course.findUnique({
        where: { slug },
        select: { id: true },
      });
      if (!course) throw new AppError('Course not found', 404);
      const userId = req.user?.userId;
      const data = await DataPoolService.getCourseData(course.id, userId);
      ApiResponse.success(res, data);
    } catch (error) { next(error); }
  }

  // ═══════════════════════════════════════════════════════
  // USER DASHBOARD
  // ═══════════════════════════════════════════════════════

  /** GET /api/dp/user/dashboard — User's learning dashboard */
  static async getUserDashboard(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const data = await DataPoolService.getUserDashboard(userId);
      ApiResponse.success(res, data);
    } catch (error) { next(error); }
  }

  // ═══════════════════════════════════════════════════════
  // VIDEO STREAMING & PROGRESS
  // ═══════════════════════════════════════════════════════

  /** POST /api/dp/course/:courseId/purchase — Create course order or free enroll */
  static async createCourseOrder(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const courseId = req.params.courseId as string;
      const userId = req.user!.userId;
      const data = await DataPoolService.createCourseOrder(courseId, userId);
      ApiResponse.created(res, data);
    } catch (error) { next(error); }
  }

  /** POST /api/dp/course/:courseId/purchase/verify — Verify payment and enroll */
  static async verifyCoursePayment(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const courseId = req.params.courseId as string;
      const userId = req.user!.userId;
      const { paymentId, razorpayPaymentId, razorpayOrderId, razorpaySignature } = req.body;
      const data = await DataPoolService.verifyCoursePayment(
        courseId, userId, paymentId, razorpayPaymentId, razorpayOrderId, razorpaySignature,
      );
      ApiResponse.success(res, data);
    } catch (error) { next(error); }
  }

  /** GET /api/dp/video/:videoId/preview-stream — Public preview stream URL (no auth) */
  static async getPreviewVideoStream(req: Request, res: Response, next: NextFunction) {
    try {
      const videoId = req.params.videoId as string;
      const data = await DataPoolService.getPreviewVideoStream(videoId);
      ApiResponse.success(res, data);
    } catch (error) { next(error); }
  }

  /** GET /api/dp/video/:videoId/stream — Secure video stream URL */
  static async getVideoStream(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const videoId = req.params.videoId as string;
      const userId = req.user!.userId;
      const data = await DataPoolService.getVideoStream(videoId, userId);
      ApiResponse.success(res, data);
    } catch (error) { next(error); }
  }

  /** POST /api/dp/video/:videoId/progress — Upsert video watching progress */
  static async updateProgress(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const videoId = req.params.videoId as string;
      const userId = req.user!.userId;
      const body = progressSchema.parse(req.body);
      const result = await DataPoolService.updateVideoProgress(videoId, userId, body);
      ApiResponse.success(res, result);
    } catch (error) { next(error); }
  }

  /** POST /api/dp/video/:videoId/event — Fire-and-forget video event tracking */
  static async trackEvent(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const videoId = req.params.videoId as string;
      const userId = req.user!.userId;
      const body = eventSchema.parse(req.body);
      const result = await DataPoolService.trackVideoEvent(videoId, userId, body);
      ApiResponse.success(res, result);
    } catch (error) { next(error); }
  }

  // ═══════════════════════════════════════════════════════
  // FEEDBACK
  // ═══════════════════════════════════════════════════════

  /** POST /api/dp/course/:courseId/feedback — Submit course rating and review */
  static async submitFeedback(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const courseId = req.params.courseId as string;
      const userId = req.user!.userId;
      const body = feedbackSchema.parse(req.body);

      const feedback = await prisma.courseFeedback.upsert({
        where: { userId_courseId: { userId, courseId } },
        create: { userId, courseId, rating: body.rating, reviewText: body.reviewText },
        update: { rating: body.rating, reviewText: body.reviewText, submittedAt: new Date() },
      });

      ApiResponse.success(res, feedback);
    } catch (error) { next(error); }
  }

  // ═══════════════════════════════════════════════════════
  // MEDIA UPLOADS (Admin)
  // ═══════════════════════════════════════════════════════

  /** POST /api/dp/admin/upload — Generate presigned upload URL for course media */
  static async getUploadUrl(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const body = courseUploadSchema.parse(req.body);
      const result = await CourseMediaService.getUploadUrl(
        body.courseId, body.folder, body.filename, body.contentType
      );
      ApiResponse.success(res, result);
    } catch (error) { next(error); }
  }

  // ═══════════════════════════════════════════════════════
  // ADMIN ANALYTICS
  // ═══════════════════════════════════════════════════════

  /** GET /api/dp/admin/analytics/video/:videoId — Detailed per-video analytics */
  static async getVideoAnalytics(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const videoId = req.params.videoId as string;
      const data = await CourseAnalyticsService.getVideoAnalytics(videoId);
      if (!data) throw new AppError('Video not found', 404);
      ApiResponse.success(res, data);
    } catch (error) { next(error); }
  }

  /** GET /api/dp/admin/analytics/course/:courseId/users — Per-user analytics */
  static async getCourseUserAnalytics(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const courseId = req.params.courseId as string;
      const data = await CourseAnalyticsService.getCourseUserAnalytics(courseId);
      ApiResponse.success(res, data);
    } catch (error) { next(error); }
  }

  /** GET /api/dp/admin/analytics/platform — Platform-wide metrics */
  static async getPlatformMetrics(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const data = await CourseAnalyticsService.getPlatformMetrics();
      ApiResponse.success(res, data);
    } catch (error) { next(error); }
  }

  /** GET /api/dp/admin/analytics/export — Export platform metrics as CSV */
  static async exportAnalyticsCsv(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const csvString = await CourseAnalyticsService.getAnalyticsCsv();
      res.header('Content-Type', 'text/csv');
      res.attachment(`caft-analytics-${new Date().toISOString().split('T')[0]}.csv`);
      res.send(csvString);
    } catch (error) { next(error); }
  }

  /** GET /api/dp/admin/analytics/user/:userId/history — Full watch history for a user */
  static async getUserWatchHistory(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.params.userId as string;
      const data = await CourseAnalyticsService.getUserWatchHistory(userId);
      ApiResponse.success(res, data);
    } catch (error) { next(error); }
  }

  /** GET /api/dp/admin/nudge/inactive — Users inactive for N days */
  static async getInactiveUsers(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const days = parseInt(req.query.days as string) || 7;
      const data = await CourseAnalyticsService.getInactiveUsers(days);
      ApiResponse.success(res, data);
    } catch (error) { next(error); }
  }

  /** GET /api/dp/admin/nudge/close-to-completion — Users close to completing a course */
  static async getCloseToCompletion(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const threshold = parseInt(req.query.threshold as string) || 80;
      const data = await CourseAnalyticsService.getCloseToCompletionUsers(threshold);
      ApiResponse.success(res, data);
    } catch (error) { next(error); }
  }

  /** POST /api/dp/admin/analytics/aggregate — Manually trigger analytics aggregation */
  static async triggerAggregation(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      await CourseAnalyticsService.runAggregationJob();
      ApiResponse.success(res, null, 'Aggregation completed');
    } catch (error) { next(error); }
  }

  /** POST /api/dp/admin/nudge/send — Send nudge email to specific users */
  static async sendNudge(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { userIds, subject, message } = sendNudgeSchema.parse(req.body);
      const result = await CourseAnalyticsService.sendNudgeEmails(userIds, subject, message);
      ApiResponse.success(res, result);
    } catch (error) { next(error); }
  }

  // ═══════════════════════════════════════════════════════
  // ADMIN VIDEO STREAM (bypasses enrollment check)
  // ═══════════════════════════════════════════════════════

  /**
   * GET /api/dp/admin/videos/:videoId/stream
   * Admin-only: returns a signed stream URL for any video, regardless of enrollment.
   * Used for preview playback in the admin curriculum editor.
   */
  static async getAdminVideoStream(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const videoId = req.params.videoId as string;
      const video = await prisma.video.findUnique({
        where: { id: videoId },
        select: { id: true, s3Key: true, thumbnailUrl: true, title: true, durationSeconds: true },
      });
      if (!video) throw new AppError('Video not found', 404);
      const streamUrl = await CourseMediaService.getStreamUrl(video.s3Key);
      ApiResponse.success(res, {
        streamUrl,
        thumbnailUrl: video.thumbnailUrl,
        title: video.title,
        durationSeconds: video.durationSeconds,
      });
    } catch (error) { next(error); }
  }

  // ═══════════════════════════════════════════════════════
  // ADMIN COURSES
  // ═══════════════════════════════════════════════════════

  /** GET /api/dp/admin/courses — Admin: List ALL courses (including unpublished) */
  static async listAllCourses(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const courses = await DataPoolService.listAllCourses();
      ApiResponse.success(res, courses);
    } catch (error) { next(error); }
  }

  /** PUT /api/dp/admin/courses/:courseId — Admin: Update a course */
  static async updateCourse(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const courseId = req.params.courseId as string;
      const body = updateCourseSchema.parse(req.body);
      const course = await DataPoolService.updateCourse(courseId, body);
      ApiResponse.success(res, course, 'Course updated');
    } catch (error) { next(error); }
  }

  /** DELETE /api/dp/admin/courses/:courseId — Admin: Delete a course */
  static async deleteCourse(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const courseId = req.params.courseId as string;
      const result = await DataPoolService.deleteCourse(courseId);
      ApiResponse.success(res, result, 'Course deleted');
    } catch (error) { next(error); }
  }

  // ═══════════════════════════════════════════════════════
  // ADMIN SECTIONS & VIDEOS
  // ═══════════════════════════════════════════════════════

  static async createSection(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { courseId, title, orderIndex } = createSectionSchema.parse(req.body);
      const section = await DataPoolService.createSection(courseId, { title, orderIndex });
      ApiResponse.created(res, section, 'Section created');
    } catch (error) { next(error); }
  }

  static async updateSection(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const sectionId = req.params.sectionId as string;
      const body = updateSectionSchema.parse(req.body);
      const section = await DataPoolService.updateSection(sectionId, body);
      ApiResponse.success(res, section, 'Section updated');
    } catch (error) { next(error); }
  }

  static async deleteSection(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const sectionId = req.params.sectionId as string;
      await DataPoolService.deleteSection(sectionId);
      ApiResponse.success(res, null, 'Section deleted');
    } catch (error) { next(error); }
  }

  static async createVideo(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const body = createVideoSchema.parse(req.body);
      const video = await DataPoolService.createVideo(body);
      ApiResponse.created(res, video, 'Video created');
    } catch (error) { next(error); }
  }

  static async updateVideo(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const videoId = req.params.videoId as string;
      const body = updateVideoSchema.parse(req.body);
      const video = await DataPoolService.updateVideo(videoId, body);
      ApiResponse.success(res, video, 'Video updated');
    } catch (error) { next(error); }
  }

  static async deleteVideo(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const videoId = req.params.videoId as string;
      await DataPoolService.deleteVideo(videoId);
      ApiResponse.success(res, null, 'Video deleted');
    } catch (error) { next(error); }
  }
}
