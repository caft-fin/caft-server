// ─────────────────────────────────────────────────────────
// CAFT Academy — Data Pool Service
// Unified data layer for the course platform frontend
// ─────────────────────────────────────────────────────────

import { prisma } from '../config/database';
import { CourseMediaService } from './courseMedia.service';
import { CertificateService } from './certificate.service';
import { AppError } from '../utils/apiResponse';
import { v4 as uuidv4 } from 'uuid';

export class DataPoolService {
  static async createCourse(data: { title: string, description: string, price: number, difficulty: string }) {
    return await prisma.course.create({
      data: {
        title: data.title,
        slug: data.title.toLowerCase().replace(/\s+/g, '-') + '-' + Math.random().toString(36).substring(2, 8),
        description: data.description,
        price: data.price,
        difficulty: data.difficulty,
        isPublished: true, // Auto-publish for now
      }
    });
  }

  // ══════════════════════════════════════════════════════
  // GET /api/dp/course/:courseId — Full course data
  // ══════════════════════════════════════════════════════

  static async getCourseData(courseId: string, userId?: string) {
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      include: {
        sections: {
          orderBy: { orderIndex: 'asc' },
          include: {
            videos: {
              where: { isPublished: true },
              orderBy: { orderIndex: 'asc' },
              select: {
                id: true,
                title: true,
                description: true,
                durationSeconds: true,
                isPreview: true,
                previewDurationSeconds: true,
                orderIndex: true,
                thumbnailUrl: true,
                s3Key: true,
              },
            },
          },
        },
        feedback: {
          select: { rating: true },
        },
        _count: {
          select: { enrollments: true, feedback: true },
        },
      },
    });

    if (!course) throw new AppError('Course not found', 404);

    // Calculate average rating
    const totalRatings = course.feedback.length;
    const avgRating = totalRatings > 0
      ? course.feedback.reduce((sum, f) => sum + f.rating, 0) / totalRatings
      : 0;

    // Get user-specific data if authenticated
    let enrollment = null;
    let userFeedback = null;
    let videoProgressMap = new Map<string, any>();

    if (userId) {
      // Check enrollment
      enrollment = await prisma.courseEnrollment.findUnique({
        where: { userId_courseId: { userId, courseId } },
        select: {
          isActive: true,
          accessType: true,
          enrolledAt: true,
          expiresAt: true,
        },
      });

      // Check if enrolled through plan subscription
      if (!enrollment && course.planId) {
        const activeSub = await prisma.subscription.findFirst({
          where: {
            userId,
            planId: course.planId,
            status: { in: ['ACTIVE', 'AUTHENTICATED'] },
          },
        });
        if (activeSub) {
          // Auto-create enrollment
          const newEnrollment = await prisma.courseEnrollment.create({
            data: {
              userId,
              courseId,
              subscriptionId: activeSub.id,
              accessType: 'FULL',
            },
          });
          enrollment = {
            isActive: true,
            accessType: 'FULL' as const,
            enrolledAt: newEnrollment.enrolledAt,
            expiresAt: null,
          };
        }
      }

      // Get user feedback for this course
      userFeedback = await prisma.courseFeedback.findUnique({
        where: { userId_courseId: { userId, courseId } },
        select: { rating: true, reviewText: true },
      });

      // Get video progress for all videos in this course
      const progressRecords = await prisma.videoProgress.findMany({
        where: { userId, courseId },
        select: {
          videoId: true,
          watchedSeconds: true,
          completionPercentage: true,
          isCompleted: true,
          resumePositionSeconds: true,
        },
      });
      progressRecords.forEach(p => videoProgressMap.set(p.videoId, p));
    }

    // Build response
    return {
      course: {
        id: course.id,
        title: course.title,
        slug: course.slug,
        description: course.description,
        thumbnailUrl: course.thumbnailUrl,
        trailerUrl: course.trailerUrl,
        price: course.price,
        currency: course.currency,
        difficulty: course.difficulty,
        language: course.language,
        totalDuration: course.totalDuration,
        totalVideos: course.totalVideos,
        isPublished: course.isPublished,
        isFeatured: course.isFeatured,
        sections: course.sections.map(section => ({
          id: section.id,
          title: section.title,
          orderIndex: section.orderIndex,
          videos: section.videos.map(video => ({
            id: video.id,
            title: video.title,
            description: video.description,
            durationSeconds: video.durationSeconds,
            isPreview: video.isPreview,
            previewDurationSeconds: video.previewDurationSeconds,
            orderIndex: video.orderIndex,
            thumbnailUrl: video.thumbnailUrl,
            progress: videoProgressMap.get(video.id) || null,
          })),
        })),
        enrollment: enrollment
          ? {
              isEnrolled: enrollment.isActive,
              accessType: enrollment.accessType,
              enrolledAt: enrollment.enrolledAt,
              expiresAt: enrollment.expiresAt,
            }
          : null,
        feedback: userFeedback,
        averageRating: Math.round(avgRating * 10) / 10,
        totalReviews: totalRatings,
        totalEnrolled: course._count.enrollments,
      },
    };
  }

  // ══════════════════════════════════════════════════════
  // GET /api/dp/user/dashboard — User learning dashboard
  // ══════════════════════════════════════════════════════

  static async getUserDashboard(userId: string) {
    // Get all enrolled courses with progress
    const enrollments = await prisma.courseEnrollment.findMany({
      where: { userId, isActive: true },
      include: {
        course: {
          select: {
            id: true,
            title: true,
            slug: true,
            thumbnailUrl: true,
            totalVideos: true,
            totalDuration: true,
          },
        },
      },
      orderBy: { enrolledAt: 'desc' },
    });

    // Get video progress for all enrolled courses
    const courseIds = enrollments.map(e => e.courseId);
    const allProgress = await prisma.videoProgress.findMany({
      where: { userId, courseId: { in: courseIds } },
      select: {
        videoId: true,
        courseId: true,
        isCompleted: true,
        watchedSeconds: true,
        lastWatchedAt: true,
        resumePositionSeconds: true,
      },
    });

    // Group progress by course
    const progressByCourse = new Map<string, typeof allProgress>();
    allProgress.forEach(p => {
      const arr = progressByCourse.get(p.courseId) || [];
      arr.push(p);
      progressByCourse.set(p.courseId, arr);
    });

    // Build enrolled courses with progress
    const enrolledCourses = enrollments.map(enrollment => {
      const courseProgress = progressByCourse.get(enrollment.courseId) || [];
      const completedVideos = courseProgress.filter(p => p.isCompleted).length;
      const totalWatched = courseProgress.reduce((sum, p) => sum + p.watchedSeconds, 0);
      const overallPercentage = enrollment.course.totalVideos > 0
        ? Math.round((completedVideos / enrollment.course.totalVideos) * 100)
        : 0;

      // Find last watched video
      const lastWatched = courseProgress
        .filter(p => !p.isCompleted)
        .sort((a, b) => new Date(b.lastWatchedAt).getTime() - new Date(a.lastWatchedAt).getTime())[0];

      return {
        course: enrollment.course,
        progress: {
          completedVideos,
          totalVideos: enrollment.course.totalVideos,
          overallPercentage,
          totalWatchedSeconds: totalWatched,
        },
        lastWatchedVideoId: lastWatched?.videoId || null,
        lastWatchedAt: lastWatched?.lastWatchedAt || null,
      };
    });

    // Continue watching — top 5 most recent in-progress videos
    const continueWatching = await prisma.videoProgress.findMany({
      where: {
        userId,
        isCompleted: false,
        watchedSeconds: { gt: 0 },
      },
      orderBy: { lastWatchedAt: 'desc' },
      take: 5,
      select: {
        videoId: true,
        resumePositionSeconds: true,
        completionPercentage: true,
        video: {
          select: {
            id: true,
            title: true,
            durationSeconds: true,
            thumbnailUrl: true,
            course: {
              select: { title: true, slug: true },
            },
          },
        },
      },
    });

    // Completed courses
    const completions = await prisma.courseCompletion.findMany({
      where: { userId },
      include: {
        course: {
          select: { id: true, title: true, slug: true, thumbnailUrl: true },
        },
      },
      orderBy: { completedAt: 'desc' },
    });

    // Badges
    const badges = await prisma.badge.findMany({
      where: { userId },
      include: {
        course: { select: { title: true } },
      },
      orderBy: { awardedAt: 'desc' },
    });

    // Stats
    const totalWatchTime = allProgress.reduce((sum, p) => sum + p.watchedSeconds, 0);

    return {
      enrolledCourses,
      continueWatching: continueWatching.map(cw => ({
        videoId: cw.video.id,
        videoTitle: cw.video.title,
        courseName: cw.video.course.title,
        courseSlug: cw.video.course.slug,
        resumePositionSeconds: cw.resumePositionSeconds,
        durationSeconds: cw.video.durationSeconds,
        thumbnailUrl: cw.video.thumbnailUrl,
        completionPercentage: cw.completionPercentage,
      })),
      completedCourses: completions.map(c => ({
        courseId: c.courseId,
        courseTitle: c.course.title,
        courseSlug: c.course.slug,
        thumbnailUrl: c.course.thumbnailUrl,
        completedAt: c.completedAt,
        certificateUrl: c.certificateUrl,
        certificateId: c.certificateId,
      })),
      badges: badges.map(b => ({
        badgeType: b.badgeType,
        courseName: b.course?.title || null,
        awardedAt: b.awardedAt,
      })),
      stats: {
        totalCoursesEnrolled: enrollments.length,
        totalCompleted: completions.length,
        totalWatchTimeSeconds: totalWatchTime,
      },
    };
  }

  // ══════════════════════════════════════════════════════
  // GET /api/dp/video/:videoId/stream — Secure stream URL
  // ══════════════════════════════════════════════════════

  static async getVideoStream(videoId: string, userId: string) {
    const video = await prisma.video.findUnique({
      where: { id: videoId },
      include: {
        course: {
          select: {
            id: true,
            planId: true,
            price: true,
            title: true,
          },
        },
        section: {
          select: {
            id: true,
            orderIndex: true,
            courseId: true,
          },
        },
      },
    });

    if (!video) throw new AppError('Video not found', 404);

    // Find next video
    const nextVideo = await DataPoolService.getNextVideo(video);

    // Check enrollment
    const enrollment = await prisma.courseEnrollment.findUnique({
      where: { userId_courseId: { userId, courseId: video.courseId } },
    });

    // Also check plan subscription
    let hasAccess = !!(enrollment?.isActive);
    if (!hasAccess && video.course.planId) {
      const activeSub = await prisma.subscription.findFirst({
        where: {
          userId,
          planId: video.course.planId,
          status: { in: ['ACTIVE', 'AUTHENTICATED'] },
        },
      });
      if (activeSub) {
        // Auto-enroll
        await prisma.courseEnrollment.upsert({
          where: { userId_courseId: { userId, courseId: video.courseId } },
          create: {
            userId,
            courseId: video.courseId,
            subscriptionId: activeSub.id,
            accessType: 'FULL',
          },
          update: { isActive: true, subscriptionId: activeSub.id },
        });
        hasAccess = true;
      }
    }

    // Get resume position
    const progress = await prisma.videoProgress.findUnique({
      where: { userId_videoId: { userId, videoId } },
    });

    // CASE 1: Full preview video — always allow
    if (video.isPreview) {
      const streamUrl = await CourseMediaService.getStreamUrl(video.s3Key);
      return {
        streamUrl,
        resumePosition: progress?.resumePositionSeconds || 0,
        durationSeconds: video.durationSeconds,
        nextVideo: nextVideo ? { id: nextVideo.id, title: nextVideo.title } : null,
        accessType: 'FULL' as const,
      };
    }

    // CASE 2: Enrolled user — full access
    if (hasAccess) {
      const streamUrl = await CourseMediaService.getStreamUrl(video.s3Key);
      return {
        streamUrl,
        resumePosition: progress?.resumePositionSeconds || 0,
        durationSeconds: video.durationSeconds,
        nextVideo: nextVideo ? { id: nextVideo.id, title: nextVideo.title } : null,
        accessType: 'FULL' as const,
      };
    }

    // CASE 3: Not enrolled but preview duration > 0
    if (video.previewDurationSeconds > 0) {
      const streamUrl = await CourseMediaService.getStreamUrl(video.s3Key, 3600); // 1 hour
      const plans = await DataPoolService.getCoursePlans(video.course.planId);
      return {
        streamUrl,
        resumePosition: 0,
        durationSeconds: video.durationSeconds,
        maxAllowedSeconds: video.previewDurationSeconds,
        nextVideo: null,
        accessType: 'PREVIEW' as const,
        cta: {
          message: 'Subscribe to continue watching',
          courseId: video.courseId,
          courseTitle: video.course.title,
          plans,
        },
      };
    }

    // CASE 4: No access at all
    const plans = await DataPoolService.getCoursePlans(video.course.planId);
    throw new AppError('SUBSCRIPTION_REQUIRED', 403, true, {
      cta: {
        message: 'Subscribe to watch this video',
        courseId: video.courseId,
        courseTitle: video.course.title,
        plans,
      },
    });
  }

  // ══════════════════════════════════════════════════════
  // POST /api/dp/video/:videoId/progress — Upsert progress
  // ══════════════════════════════════════════════════════

  static async updateVideoProgress(
    videoId: string,
    userId: string,
    data: { watchedSeconds: number; resumePositionSeconds: number; completionPercentage: number },
  ) {
    const video = await prisma.video.findUnique({
      where: { id: videoId },
      select: { courseId: true, durationSeconds: true },
    });
    if (!video) throw new AppError('Video not found', 404);

    const isCompleted = data.completionPercentage >= 95;

    const progress = await prisma.videoProgress.upsert({
      where: { userId_videoId: { userId, videoId } },
      create: {
        userId,
        videoId,
        courseId: video.courseId,
        watchedSeconds: data.watchedSeconds,
        resumePositionSeconds: data.resumePositionSeconds,
        completionPercentage: Math.min(data.completionPercentage, 100),
        isCompleted,
        lastWatchedAt: new Date(),
      },
      update: {
        watchedSeconds: Math.max(data.watchedSeconds, 0),
        resumePositionSeconds: data.resumePositionSeconds,
        completionPercentage: Math.min(data.completionPercentage, 100),
        isCompleted,
        lastWatchedAt: new Date(),
      },
    });

    // Check if course is now fully completed
    let courseCompleted = false;
    if (isCompleted) {
      courseCompleted = await DataPoolService.checkAndCompleteCourse(userId, video.courseId);
    }

    return {
      saved: true,
      isCompleted: progress.isCompleted,
      courseCompleted,
    };
  }

  // ══════════════════════════════════════════════════════
  // POST /api/dp/video/:videoId/event — Track event
  // ══════════════════════════════════════════════════════

  static async trackVideoEvent(
    videoId: string,
    userId: string,
    data: { eventType: string; positionSeconds: number; metadata?: Record<string, any> },
  ) {
    // Fire-and-forget — don't block the response
    prisma.videoEvent.create({
      data: {
        userId,
        videoId,
        eventType: data.eventType as any,
        positionSeconds: data.positionSeconds,
        metadataJson: data.metadata || undefined,
      },
    }).catch(err => {
      console.error('Failed to track video event:', err);
    });

    return { recorded: true };
  }

  // ══════════════════════════════════════════════════════
  // Helpers
  // ══════════════════════════════════════════════════════

  /**
   * Find the next video after the current one (by orderIndex/section)
   */
  private static async getNextVideo(currentVideo: {
    id: string;
    orderIndex: number;
    courseId: string;
    section: { id: string; orderIndex: number; courseId: string };
  }) {
    // Try next video in same section
    const nextInSection = await prisma.video.findFirst({
      where: {
        sectionId: currentVideo.section.id,
        orderIndex: { gt: currentVideo.orderIndex },
        isPublished: true,
      },
      orderBy: { orderIndex: 'asc' },
      select: { id: true, title: true },
    });

    if (nextInSection) return nextInSection;

    // Try first video of next section
    const nextSection = await prisma.courseSection.findFirst({
      where: {
        courseId: currentVideo.courseId,
        orderIndex: { gt: currentVideo.section.orderIndex },
      },
      orderBy: { orderIndex: 'asc' },
      include: {
        videos: {
          where: { isPublished: true },
          orderBy: { orderIndex: 'asc' },
          take: 1,
          select: { id: true, title: true },
        },
      },
    });

    return nextSection?.videos[0] || null;
  }

  /**
   * Check if all videos in a course are completed → trigger completion flow
   */
  private static async checkAndCompleteCourse(userId: string, courseId: string): Promise<boolean> {
    const totalVideos = await prisma.video.count({
      where: { courseId, isPublished: true },
    });

    const completedVideos = await prisma.videoProgress.count({
      where: { userId, courseId, isCompleted: true },
    });

    if (completedVideos < totalVideos) return false;

    // All videos completed — check if already marked as complete
    const existing = await prisma.courseCompletion.findUnique({
      where: { userId_courseId: { userId, courseId } },
    });
    if (existing) return true; // Already completed

    // Create completion record
    const certificateId = `CAFT-${uuidv4().slice(0, 8).toUpperCase()}`;
    const now = new Date();

    // 1. Generate PDF certificate and upload to S3
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    const course = await prisma.course.findUnique({ where: { id: courseId }, select: { title: true } });
    
    let certificateUrl = null;
    if (user && course) {
      certificateUrl = await CertificateService.issueCertificate(
        userId,
        courseId,
        user.name,
        course.title,
        certificateId,
        now
      );
    }

    await prisma.courseCompletion.create({
      data: {
        userId,
        courseId,
        certificateId,
        certificateUrl,
        badgeAwarded: true,
      },
    });

    // Award badge
    await prisma.badge.create({
      data: {
        userId,
        courseId,
        badgeType: 'COURSE_COMPLETE',
      },
    });

    // Check if this is the user's first course
    const totalCompletions = await prisma.courseCompletion.count({
      where: { userId },
    });
    if (totalCompletions === 1) {
      await prisma.badge.create({
        data: {
          userId,
          courseId,
          badgeType: 'FIRST_COURSE',
        },
      });
    }

    // Send congratulatory email via SES
    if (user) {
      const userRecord = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
      if (userRecord?.email) {
        try {
          const { EmailService } = await import('./email.service');
          await EmailService.sendCampaignEmail(
            userRecord.email,
            `🎉 Congratulations! You've completed "${course?.title}"`,
            `
            <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
              <div style="text-align: center; margin-bottom: 32px;">
                <div style="font-size: 64px; margin-bottom: 16px;">🎉</div>
                <h1 style="color: #111827; font-size: 28px; font-weight: 700; margin: 0 0 8px 0;">Congratulations!</h1>
                <p style="color: #6b7280; font-size: 16px; margin: 0;">You've successfully completed</p>
              </div>
              
              <div style="background: linear-gradient(135deg, #3b82f6, #1e3a8a); border-radius: 16px; padding: 32px; text-align: center; margin-bottom: 32px;">
                <h2 style="color: white; font-size: 24px; font-weight: 700; margin: 0 0 8px 0;">${course?.title || 'the course'}</h2>
                <p style="color: rgba(255,255,255,0.8); font-size: 14px; margin: 0;">Certificate ID: ${certificateId}</p>
              </div>
              
              <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 32px;">
                <p style="color: #166534; font-size: 16px; font-weight: 600; margin: 0 0 8px 0;">🏆 Badge Awarded: Course Complete</p>
                <p style="color: #15803d; font-size: 14px; margin: 0;">Your certificate is ready for download in your learning dashboard.</p>
              </div>
              
              <div style="text-align: center;">
                <p style="color: #6b7280; font-size: 14px;">Keep learning and growing! 🚀</p>
              </div>
            </div>
            `
          );
        } catch (emailErr) {
          console.error('Failed to send course completion email:', emailErr);
          // Don't throw — email failure shouldn't block completion
        }
      }
    }

    return true;
  }

  /**
   * Get pricing plans for a course's linked plan
   */
  private static async getCoursePlans(planId: string | null) {
    if (!planId) return [];

    const plan = await prisma.plan.findUnique({
      where: { id: planId },
      include: {
        pricing: {
          where: { isActive: true },
          orderBy: { billingCycle: 'asc' },
          select: {
            billingCycle: true,
            price: true,
          },
        },
      },
    });

    if (!plan) return [];

    return [{
      id: plan.id,
      name: plan.name,
      pricing: plan.pricing.map(p => ({
        billingCycle: p.billingCycle,
        price: p.price, // in paise
      })),
    }];
  }

  // ══════════════════════════════════════════════════════
  // Course Listing (public)
  // ══════════════════════════════════════════════════════

  static async listCourses(filters?: { difficulty?: string; isFeatured?: boolean }) {
    const where: any = { isPublished: true };
    if (filters?.difficulty) where.difficulty = filters.difficulty;
    if (filters?.isFeatured !== undefined) where.isFeatured = filters.isFeatured;

    const courses = await prisma.course.findMany({
      where,
      select: {
        id: true,
        title: true,
        slug: true,
        description: true,
        thumbnailUrl: true,
        price: true,
        currency: true,
        difficulty: true,
        totalDuration: true,
        totalVideos: true,
        isFeatured: true,
        _count: { select: { enrollments: true, feedback: true } },
        feedback: { select: { rating: true } },
      },
      orderBy: [
        { isFeatured: 'desc' },
        { createdAt: 'desc' },
      ],
    });

    return courses.map(c => ({
      ...c,
      feedback: undefined,
      averageRating: c.feedback.length > 0
        ? Math.round((c.feedback.reduce((s, f) => s + f.rating, 0) / c.feedback.length) * 10) / 10
        : 0,
      totalEnrolled: c._count.enrollments,
      totalReviews: c._count.feedback,
    }));
  }

  // ══════════════════════════════════════════════════════
  // Admin — List ALL courses (including unpublished)
  // ══════════════════════════════════════════════════════

  static async listAllCourses() {
    const courses = await prisma.course.findMany({
      select: {
        id: true,
        title: true,
        slug: true,
        description: true,
        thumbnailUrl: true,
        price: true,
        currency: true,
        difficulty: true,
        totalDuration: true,
        totalVideos: true,
        isFeatured: true,
        isPublished: true,
        createdAt: true,
        _count: { select: { enrollments: true, feedback: true, sections: true } },
        sections: { 
          select: { 
            id: true, title: true, orderIndex: true,
            videos: { select: { id: true, title: true, description: true, durationSeconds: true, isPublished: true, isPreview: true, orderIndex: true }, orderBy: { orderIndex: 'asc' } }
          }, 
          orderBy: { orderIndex: 'asc' } 
        },
        feedback: { select: { rating: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return courses.map(c => ({
      ...c,
      feedback: undefined,
      averageRating: c.feedback.length > 0
        ? Math.round((c.feedback.reduce((s, f) => s + f.rating, 0) / c.feedback.length) * 10) / 10
        : 0,
      totalEnrolled: c._count.enrollments,
      totalReviews: c._count.feedback,
      totalSections: c._count.sections,
    }));
  }

  // ══════════════════════════════════════════════════════
  // Admin — Update a course
  // ══════════════════════════════════════════════════════

  static async updateCourse(courseId: string, data: {
    title?: string; description?: string; price?: number;
    difficulty?: string; isPublished?: boolean; isFeatured?: boolean;
    thumbnailUrl?: string; trailerUrl?: string; trailerS3Key?: string;
  }) {
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw new AppError('Course not found', 404);

    return await prisma.course.update({
      where: { id: courseId },
      data,
    });
  }

  // ══════════════════════════════════════════════════════
  // Admin — Course Sections
  // ══════════════════════════════════════════════════════

  static async createSection(courseId: string, data: { title: string; orderIndex?: number }) {
    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw new AppError('Course not found', 404);

    let orderIndex = data.orderIndex;
    if (orderIndex === undefined) {
      const lastSection = await prisma.courseSection.findFirst({
        where: { courseId },
        orderBy: { orderIndex: 'desc' },
      });
      orderIndex = lastSection ? lastSection.orderIndex + 1 : 0;
    }

    return await prisma.courseSection.create({
      data: {
        courseId,
        title: data.title,
        orderIndex,
      },
    });
  }

  static async updateSection(sectionId: string, data: { title?: string; orderIndex?: number }) {
    return await prisma.courseSection.update({
      where: { id: sectionId },
      data,
    });
  }

  static async deleteSection(sectionId: string) {
    // Delete associated videos first
    const videos = await prisma.video.findMany({ where: { sectionId }, select: { id: true } });
    const videoIds = videos.map(v => v.id);

    if (videoIds.length > 0) {
      await prisma.videoProgress.deleteMany({ where: { videoId: { in: videoIds } } });
      await prisma.videoEvent.deleteMany({ where: { videoId: { in: videoIds } } });
      await prisma.video.deleteMany({ where: { sectionId } });
    }

    return await prisma.courseSection.delete({
      where: { id: sectionId },
    });
  }

  // ══════════════════════════════════════════════════════
  // Admin — Videos
  // ══════════════════════════════════════════════════════

  static async createVideo(data: {
    courseId: string;
    sectionId: string;
    title: string;
    description?: string;
    s3Key: string;
    durationSeconds?: number;
    isPreview?: boolean;
    previewDurationSeconds?: number;
    orderIndex?: number;
    thumbnailUrl?: string;
  }) {
    const section = await prisma.courseSection.findUnique({ where: { id: data.sectionId } });
    if (!section) throw new AppError('Section not found', 404);

    let orderIndex = data.orderIndex;
    if (orderIndex === undefined) {
      const lastVideo = await prisma.video.findFirst({
        where: { sectionId: data.sectionId },
        orderBy: { orderIndex: 'desc' },
      });
      orderIndex = lastVideo ? lastVideo.orderIndex + 1 : 0;
    }

    const video = await prisma.video.create({
      data: {
        courseId: data.courseId,
        sectionId: data.sectionId,
        title: data.title,
        description: data.description,
        s3Key: data.s3Key,
        durationSeconds: data.durationSeconds || 0,
        isPreview: data.isPreview || false,
        previewDurationSeconds: data.previewDurationSeconds || 0,
        orderIndex,
        thumbnailUrl: data.thumbnailUrl,
      },
    });

    // Update total duration and video count in course
    const allVideos = await prisma.video.findMany({ where: { courseId: data.courseId } });
    const totalDuration = allVideos.reduce((sum, v) => sum + v.durationSeconds, 0);
    await prisma.course.update({
      where: { id: data.courseId },
      data: {
        totalVideos: allVideos.length,
        totalDuration,
      },
    });

    return video;
  }

  static async updateVideo(videoId: string, data: {
    title?: string;
    description?: string;
    durationSeconds?: number;
    isPreview?: boolean;
    previewDurationSeconds?: number;
    orderIndex?: number;
    isPublished?: boolean;
    thumbnailUrl?: string;
  }) {
    const video = await prisma.video.update({
      where: { id: videoId },
      data,
    });

    if (data.durationSeconds !== undefined) {
      const allVideos = await prisma.video.findMany({ where: { courseId: video.courseId } });
      const totalDuration = allVideos.reduce((sum, v) => sum + v.durationSeconds, 0);
      await prisma.course.update({
        where: { id: video.courseId },
        data: { totalDuration },
      });
    }

    return video;
  }

  static async deleteVideo(videoId: string) {
    const video = await prisma.video.findUnique({ where: { id: videoId } });
    if (!video) throw new AppError('Video not found', 404);

    await prisma.videoProgress.deleteMany({ where: { videoId } });
    await prisma.videoEvent.deleteMany({ where: { videoId } });
    await prisma.video.delete({ where: { id: videoId } });

    // Update total duration and video count in course
    const allVideos = await prisma.video.findMany({ where: { courseId: video.courseId } });
    const totalDuration = allVideos.reduce((sum, v) => sum + v.durationSeconds, 0);
    await prisma.course.update({
      where: { id: video.courseId },
      data: {
        totalVideos: allVideos.length,
        totalDuration,
      },
    });

    return { deleted: true };
  }

  // ══════════════════════════════════════════════════════
  // Admin — Delete a course
  // ══════════════════════════════════════════════════════

  static async deleteCourse(courseId: string) {
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      include: { _count: { select: { enrollments: true } } },
    });
    if (!course) throw new AppError('Course not found', 404);

    if (course._count.enrollments > 0) {
      // Soft delete — just unpublish
      await prisma.course.update({ where: { id: courseId }, data: { isPublished: false } });
      return { deleted: false, unpublished: true };
    }

    // Hard delete — remove all related data
    await prisma.videoProgress.deleteMany({ where: { courseId } });
    await prisma.videoEvent.deleteMany({ where: { video: { courseId } } });
    await prisma.video.deleteMany({ where: { section: { courseId } } });
    await prisma.courseSection.deleteMany({ where: { courseId } });
    await prisma.courseFeedback.deleteMany({ where: { courseId } });
    await prisma.course.delete({ where: { id: courseId } });
    return { deleted: true, unpublished: false };
  }
}
