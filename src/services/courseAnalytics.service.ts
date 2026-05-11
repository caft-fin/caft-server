// ─────────────────────────────────────────────────────────
// CAFT Academy — Course Analytics Service
// Admin analytics, aggregation jobs, and reporting
// ─────────────────────────────────────────────────────────

import { prisma } from '../config/database';
import { EmailService } from './email.service';

export class CourseAnalyticsService {
  // ══════════════════════════════════════════════════════
  // Per-Video Analytics
  // ══════════════════════════════════════════════════════

  static async getVideoAnalytics(videoId: string) {
    const video = await prisma.video.findUnique({
      where: { id: videoId },
      select: { id: true, title: true, durationSeconds: true, courseId: true },
    });
    if (!video) return null;

    // Get aggregated stats
    const [totalViews, uniqueViewers, avgDuration, completionCount] = await Promise.all([
      prisma.videoEvent.count({
        where: { videoId, eventType: 'PLAY' },
      }),
      prisma.videoProgress.count({
        where: { videoId },
      }),
      prisma.videoProgress.aggregate({
        where: { videoId },
        _avg: { watchedSeconds: true },
      }),
      prisma.videoProgress.count({
        where: { videoId, isCompleted: true },
      }),
    ]);

    const completionRate = uniqueViewers > 0 ? (completionCount / uniqueViewers) * 100 : 0;

    // Drop-off analysis — aggregate exit/pause events by position bucket (10% intervals)
    const exitEvents = await prisma.videoEvent.findMany({
      where: { videoId, eventType: { in: ['EXIT', 'PAUSE'] } },
      select: { positionSeconds: true },
    });

    const dropOffBuckets: Record<string, number> = {};
    const bucketSize = Math.max(1, Math.floor(video.durationSeconds / 10));
    exitEvents.forEach(e => {
      const bucket = Math.floor(e.positionSeconds / bucketSize) * bucketSize;
      const label = `${bucket}s-${bucket + bucketSize}s`;
      dropOffBuckets[label] = (dropOffBuckets[label] || 0) + 1;
    });

    // Skip/fast-forward heatmap
    const skipEvents = await prisma.videoEvent.findMany({
      where: { videoId, eventType: { in: ['FAST_FORWARD', 'SKIP_SECTION'] } },
      select: { positionSeconds: true, metadataJson: true },
    });

    const skipBuckets: Record<string, number> = {};
    skipEvents.forEach(e => {
      const bucket = Math.floor(e.positionSeconds / bucketSize) * bucketSize;
      const label = `${bucket}s-${bucket + bucketSize}s`;
      skipBuckets[label] = (skipBuckets[label] || 0) + 1;
    });

    return {
      videoId: video.id,
      videoTitle: video.title,
      durationSeconds: video.durationSeconds,
      totalViews,
      uniqueViewers,
      avgWatchDuration: avgDuration._avg.watchedSeconds || 0,
      completionRate: Math.round(completionRate * 10) / 10,
      completionCount,
      dropOffBuckets,
      skipHeatmap: skipBuckets,
    };
  }

  // ══════════════════════════════════════════════════════
  // Per-User Analytics (for a specific course)
  // ══════════════════════════════════════════════════════

  static async getCourseUserAnalytics(courseId: string) {
    const enrollments = await prisma.courseEnrollment.findMany({
      where: { courseId },
      include: {
        user: {
          select: { id: true, name: true, email: true, lastLoginAt: true },
        },
      },
    });

    const totalVideos = await prisma.video.count({
      where: { courseId, isPublished: true },
    });

    const userAnalytics = await Promise.all(
      enrollments.map(async enrollment => {
        const progress = await prisma.videoProgress.findMany({
          where: { userId: enrollment.userId, courseId },
        });

        const watchedCount = progress.filter(p => p.watchedSeconds > 0).length;
        const completedCount = progress.filter(p => p.isCompleted).length;
        const totalWatched = progress.reduce((sum, p) => sum + p.watchedSeconds, 0);
        const completionPct = totalVideos > 0 ? (completedCount / totalVideos) * 100 : 0;

        // Check for fast-forward abuse
        const ffEvents = await prisma.videoEvent.count({
          where: {
            userId: enrollment.userId,
            video: { courseId },
            eventType: { in: ['FAST_FORWARD', 'SKIP_SECTION'] },
          },
        });
        const totalEvents = await prisma.videoEvent.count({
          where: {
            userId: enrollment.userId,
            video: { courseId },
          },
        });
        const skipRatio = totalEvents > 0 ? ffEvents / totalEvents : 0;

        // Last activity
        const lastProgress = progress.sort(
          (a, b) => new Date(b.lastWatchedAt).getTime() - new Date(a.lastWatchedAt).getTime()
        )[0];

        const daysSinceActivity = lastProgress
          ? Math.floor((Date.now() - new Date(lastProgress.lastWatchedAt).getTime()) / 86400000)
          : null;

        return {
          userId: enrollment.user.id,
          userName: enrollment.user.name,
          userEmail: enrollment.user.email,
          enrolledAt: enrollment.enrolledAt,
          videosWatched: watchedCount,
          videosCompleted: completedCount,
          videosSkipped: Math.max(0, totalVideos - watchedCount),
          completionPercentage: Math.round(completionPct),
          totalWatchTimeSeconds: totalWatched,
          lastActiveAt: lastProgress?.lastWatchedAt || null,
          daysSinceActivity,
          flags: {
            inactive7Days: daysSinceActivity !== null && daysSinceActivity >= 7,
            closeToCompletion: completionPct >= 80 && completionPct < 100,
            suspiciousSkipping: skipRatio > 0.3,
          },
        };
      })
    );

    return {
      courseId,
      totalEnrolled: enrollments.length,
      totalVideos,
      users: userAnalytics,
    };
  }

  // ══════════════════════════════════════════════════════
  // Platform-Wide Metrics
  // ══════════════════════════════════════════════════════

  static async getPlatformMetrics() {
    const [
      totalEnrollments,
      activeEnrollments,
      totalCompletions,
      totalCourses,
      publishedCourses,
    ] = await Promise.all([
      prisma.courseEnrollment.count(),
      prisma.courseEnrollment.count({ where: { isActive: true } }),
      prisma.courseCompletion.count(),
      prisma.course.count(),
      prisma.course.count({ where: { isPublished: true } }),
    ]);

    // Revenue per course (from linked plan subscriptions)
    const coursesWithRevenue = await prisma.course.findMany({
      where: { planId: { not: null } },
      select: {
        id: true,
        title: true,
        planId: true,
        _count: { select: { enrollments: true, completions: true } },
      },
    });

    const revenueByCourseProm = coursesWithRevenue.map(async course => {
      const revenue = await prisma.payment.aggregate({
        where: {
          subscription: { planId: course.planId! },
          status: 'CAPTURED',
        },
        _sum: { amount: true },
      });
      return {
        courseId: course.id,
        courseTitle: course.title,
        revenue: (revenue._sum.amount || 0) / 100, // paise to rupees
        enrollments: course._count.enrollments,
        completions: course._count.completions,
        completionRate: course._count.enrollments > 0
          ? Math.round((course._count.completions / course._count.enrollments) * 100)
          : 0,
      };
    });
    const revenuePerCourse = await Promise.all(revenueByCourseProm);

    // Most watched videos
    const mostWatched = await prisma.videoAnalytics.findMany({
      orderBy: { totalViews: 'desc' },
      take: 10,
      include: {
        video: { select: { title: true, course: { select: { title: true } } } },
      },
    });

    // Highest drop-off videos (lowest completion rate with at least 10 viewers)
    const highestDropOff = await prisma.videoAnalytics.findMany({
      where: { uniqueViewers: { gte: 10 } },
      orderBy: { completionRate: 'asc' },
      take: 10,
      include: {
        video: { select: { title: true, course: { select: { title: true } } } },
      },
    });

    // Daily active learners (last 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
    const dailyActiveLearners = await prisma.videoProgress.groupBy({
      by: ['userId'],
      where: { lastWatchedAt: { gte: sevenDaysAgo } },
    });

    // Feedback pending (completed but no review)
    const feedbackPending = await prisma.courseCompletion.count({
      where: {
        NOT: {
          user: {
            courseFeedback: {
              some: {},
            },
          },
        },
      },
    });

    return {
      overview: {
        totalCourses,
        publishedCourses,
        totalEnrollments,
        activeEnrollments,
        totalCompletions,
        overallCompletionRate: totalEnrollments > 0
          ? Math.round((totalCompletions / totalEnrollments) * 100)
          : 0,
        activeLearners7d: dailyActiveLearners.length,
        feedbackPending,
      },
      revenuePerCourse,
      mostWatchedVideos: mostWatched.map(v => ({
        videoTitle: v.video.title,
        courseTitle: v.video.course.title,
        totalViews: v.totalViews,
        uniqueViewers: v.uniqueViewers,
        completionRate: v.completionRate,
      })),
      highestDropOff: highestDropOff.map(v => ({
        videoTitle: v.video.title,
        courseTitle: v.video.course.title,
        completionRate: v.completionRate,
        uniqueViewers: v.uniqueViewers,
      })),
    };
  }

  static async getAnalyticsCsv() {
    const data = await this.getPlatformMetrics();

    let csv = 'Video Title,Course Title,Total Views,Unique Viewers,Completion Rate (%)\n';
    
    // Add all aggregated video analytics
    const allVideos = await prisma.videoAnalytics.findMany({
      include: {
        video: { select: { title: true, course: { select: { title: true } } } },
      },
      orderBy: { totalViews: 'desc' },
    });

    for (const v of allVideos) {
      // Escape commas in titles
      const vTitle = v.video.title.replace(/,/g, '');
      const cTitle = v.video.course.title.replace(/,/g, '');
      csv += `${vTitle},${cTitle},${v.totalViews},${v.uniqueViewers},${v.completionRate}\n`;
    }

    return csv;
  }

  // ══════════════════════════════════════════════════════
  // Aggregation Job — Update video_analytics from events
  // ══════════════════════════════════════════════════════

  static async runAggregationJob() {
    console.log('🔄 Running video analytics aggregation...');

    const videos = await prisma.video.findMany({
      where: { isPublished: true },
      select: { id: true, courseId: true, durationSeconds: true },
    });

    for (const video of videos) {
      const [totalViews, uniqueViewers, avgDuration, completionCount] = await Promise.all([
        prisma.videoEvent.count({
          where: { videoId: video.id, eventType: 'PLAY' },
        }),
        prisma.videoProgress.count({
          where: { videoId: video.id },
        }),
        prisma.videoProgress.aggregate({
          where: { videoId: video.id },
          _avg: { watchedSeconds: true },
        }),
        prisma.videoProgress.count({
          where: { videoId: video.id, isCompleted: true },
        }),
      ]);

      const completionRate = uniqueViewers > 0 ? (completionCount / uniqueViewers) * 100 : 0;

      await prisma.videoAnalytics.upsert({
        where: { videoId: video.id },
        create: {
          videoId: video.id,
          courseId: video.courseId,
          totalViews,
          uniqueViewers,
          avgWatchDuration: avgDuration._avg.watchedSeconds || 0,
          completionRate: Math.round(completionRate * 10) / 10,
        },
        update: {
          totalViews,
          uniqueViewers,
          avgWatchDuration: avgDuration._avg.watchedSeconds || 0,
          completionRate: Math.round(completionRate * 10) / 10,
        },
      });
    }

    console.log(`✅ Aggregated analytics for ${videos.length} videos`);
  }

  // ══════════════════════════════════════════════════════
  // User Watch History (admin view)
  // ══════════════════════════════════════════════════════

  static async getUserWatchHistory(userId: string) {
    const events = await prisma.videoEvent.findMany({
      where: { userId },
      orderBy: { eventTimestamp: 'desc' },
      take: 200,
      include: {
        video: {
          select: { title: true, course: { select: { title: true } } },
        },
      },
    });

    return events.map(e => ({
      eventType: e.eventType,
      videoTitle: e.video.title,
      courseTitle: e.video.course.title,
      positionSeconds: e.positionSeconds,
      metadata: e.metadataJson,
      timestamp: e.eventTimestamp,
    }));
  }

  // ══════════════════════════════════════════════════════
  // Nudge Candidates
  // ══════════════════════════════════════════════════════

  static async getInactiveUsers(daysSince = 7) {
    const cutoff = new Date(Date.now() - daysSince * 86400000);

    const inactiveEnrollments = await prisma.courseEnrollment.findMany({
      where: {
        isActive: true,
        user: {
          videoProgress: {
            every: {
              lastWatchedAt: { lt: cutoff },
            },
          },
        },
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        course: { select: { id: true, title: true } },
      },
    });

    return inactiveEnrollments.map(e => ({
      userId: e.user.id,
      userName: e.user.name,
      userEmail: e.user.email,
      courseId: e.course.id,
      courseTitle: e.course.title,
      enrolledAt: e.enrolledAt,
    }));
  }

  static async getCloseToCompletionUsers(threshold = 80) {
    const enrollments = await prisma.courseEnrollment.findMany({
      where: { isActive: true },
      include: {
        user: { select: { id: true, name: true, email: true } },
        course: { select: { id: true, title: true, totalVideos: true } },
      },
    });

    const results = [];
    for (const e of enrollments) {
      if (e.course.totalVideos === 0) continue;
      const completedCount = await prisma.videoProgress.count({
        where: { userId: e.userId, courseId: e.courseId, isCompleted: true },
      });
      const pct = (completedCount / e.course.totalVideos) * 100;
      if (pct >= threshold && pct < 100) {
        results.push({
          userId: e.user.id,
          userName: e.user.name,
          userEmail: e.user.email,
          courseId: e.course.id,
          courseTitle: e.course.title,
          completionPercentage: Math.round(pct),
          videosRemaining: e.course.totalVideos - completedCount,
        });
      }
    }
    return results;
  }

  static async sendNudgeEmails(userIds: string[], subject: string, message: string) {
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { email: true, name: true },
    });

    let sentCount = 0;
    const errors: string[] = [];

    for (const user of users) {
      if (!user.email) continue;
      try {
        const html = `
        <div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
          <h2 style="color: #111827; font-size: 24px; font-weight: 700; margin-bottom: 16px;">Hello ${user.name},</h2>
          <p style="color: #4b5563; font-size: 16px; line-height: 1.5; margin-bottom: 24px;">
            ${message.replace(/\n/g, '<br/>')}
          </p>
          <a href="https://caft.financial/dashboard/learning" style="display: inline-block; background: #3b82f6; color: white; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: 600;">Go to Dashboard</a>
        </div>
        `;
        await EmailService.sendCampaignEmail(user.email, subject, html);
        sentCount++;
      } catch (err: any) {
        errors.push(`Failed to send to ${user.email}: ${err.message}`);
      }
    }

    return { sentCount, errors, totalRequested: userIds.length };
  }
}
