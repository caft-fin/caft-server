// ─────────────────────────────────────────────────────────
// CAFT Financial — Email Campaign Controller (Admin)
// ─────────────────────────────────────────────────────────

import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { ApiResponse } from '../utils/apiResponse';
import { AppError } from '../utils/apiResponse';
import { AuthenticatedRequest } from '../types';
import { createCampaignSchema, updateCampaignSchema, createTemplateSchema, updateTemplateSchema } from '../utils/validators';
import { EmailService } from '../services/email.service';

export class EmailController {
  /** GET /api/admin/campaigns */
  static async getCampaigns(_req: Request, res: Response, next: NextFunction) {
    try {
      const campaigns = await prisma.emailCampaign.findMany({
        include: { template: { select: { name: true } }, _count: { select: { recipients: true } } },
        orderBy: { createdAt: 'desc' },
      });
      ApiResponse.success(res, campaigns);
    } catch (error) { next(error); }
  }

  /** POST /api/admin/campaigns */
  static async createCampaign(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const input = createCampaignSchema.parse(req.body);
      const campaign = await prisma.emailCampaign.create({
        data: {
          name: input.name,
          subject: input.subject,
          templateId: input.templateId,
          htmlContent: input.htmlContent,
          scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
          status: input.scheduledAt ? 'SCHEDULED' : 'DRAFT',
        },
      });

      // If recipient filter provided, add recipients
      if (input.recipientFilter) {
        const userWhere: any = {};
        if (input.recipientFilter.isActive !== undefined) userWhere.isActive = input.recipientFilter.isActive;
        if (input.recipientFilter.roles?.length) userWhere.role = { in: input.recipientFilter.roles };

        const users = await prisma.user.findMany({
          where: userWhere,
          select: { id: true, email: true },
        });

        if (users.length > 0) {
          await prisma.emailRecipient.createMany({
            data: users.map((u) => ({
              campaignId: campaign.id,
              userId: u.id,
              email: u.email,
            })),
          });
        }
      }

      ApiResponse.created(res, campaign, 'Campaign created');
    } catch (error) { next(error); }
  }

  /** PUT /api/admin/campaigns/:id */
  static async updateCampaign(req: Request, res: Response, next: NextFunction) {
    try {
      const input = updateCampaignSchema.parse(req.body);
      const campaign = await prisma.emailCampaign.update({
        where: { id: req.params.id as string },
        data: {
          ...(input.name && { name: input.name }),
          ...(input.subject && { subject: input.subject }),
          ...(input.templateId && { templateId: input.templateId }),
          ...(input.htmlContent && { htmlContent: input.htmlContent }),
          ...(input.scheduledAt !== undefined && { scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null }),
        },
      });
      ApiResponse.success(res, campaign, 'Campaign updated');
    } catch (error) { next(error); }
  }

  /** POST /api/admin/campaigns/:id/send — Dispatch campaign */
  static async sendCampaign(req: Request, res: Response, next: NextFunction) {
    try {
      const campaign = await prisma.emailCampaign.findUnique({
        where: { id: req.params.id as string },
        include: { recipients: true, template: true },
      });

      if (!campaign) throw new AppError('Campaign not found', 404);
      if (campaign.status === 'SENDING') throw new AppError('Campaign is already being sent', 409);

      const htmlContent = campaign.htmlContent || campaign.template?.htmlContent;
      if (!htmlContent) throw new AppError('No email content defined', 400);

      // Mark as sending
      await prisma.emailCampaign.update({
        where: { id: campaign.id },
        data: { status: 'SENDING', startedAt: new Date() },
      });

      // Send emails asynchronously (fire and forget for speed)
      let sentCount = 0;
      let failedCount = 0;

      for (const recipient of campaign.recipients) {
        try {
          await EmailService.sendCampaignEmail(recipient.email, campaign.subject, htmlContent);
          await prisma.emailRecipient.update({
            where: { id: recipient.id },
            data: { deliveryStatus: 'SENT', sentAt: new Date() },
          });
          sentCount++;
        } catch {
          await prisma.emailRecipient.update({
            where: { id: recipient.id },
            data: { deliveryStatus: 'FAILED', failureReason: 'Send failed' },
          });
          failedCount++;
        }
      }

      // Mark completed
      await prisma.emailCampaign.update({
        where: { id: campaign.id },
        data: { status: 'COMPLETED', completedAt: new Date(), totalSent: sentCount, totalFailed: failedCount },
      });

      ApiResponse.success(res, { sent: sentCount, failed: failedCount }, 'Campaign dispatched');
    } catch (error) { next(error); }
  }

  /** POST /api/admin/campaigns/:id/pause */
  static async pauseCampaign(req: Request, res: Response, next: NextFunction) {
    try {
      await prisma.emailCampaign.update({
        where: { id: req.params.id as string },
        data: { status: 'PAUSED' },
      });
      ApiResponse.success(res, null, 'Campaign paused');
    } catch (error) { next(error); }
  }

  /** GET /api/admin/campaigns/:id/stats */
  static async getCampaignStats(req: Request, res: Response, next: NextFunction) {
    try {
      const campaign = await prisma.emailCampaign.findUnique({
        where: { id: req.params.id as string },
        include: {
          _count: { select: { recipients: true } },
        },
      });
      if (!campaign) throw new AppError('Campaign not found', 404);

      ApiResponse.success(res, {
        name: campaign.name,
        status: campaign.status,
        totalRecipients: campaign._count.recipients,
        totalSent: campaign.totalSent,
        totalDelivered: campaign.totalDelivered,
        totalOpened: campaign.totalOpened,
        totalClicked: campaign.totalClicked,
        totalBounced: campaign.totalBounced,
        totalFailed: campaign.totalFailed,
        openRate: campaign.totalSent > 0 ? ((campaign.totalOpened / campaign.totalSent) * 100).toFixed(1) : '0.0',
        clickRate: campaign.totalSent > 0 ? ((campaign.totalClicked / campaign.totalSent) * 100).toFixed(1) : '0.0',
      });
    } catch (error) { next(error); }
  }

  // ── Template CRUD ────────────────────────────────────

  /** GET /api/admin/templates */
  static async getTemplates(_req: Request, res: Response, next: NextFunction) {
    try {
      const templates = await prisma.emailTemplate.findMany({ orderBy: { updatedAt: 'desc' } });
      ApiResponse.success(res, templates);
    } catch (error) { next(error); }
  }

  /** POST /api/admin/templates */
  static async createTemplate(req: Request, res: Response, next: NextFunction) {
    try {
      const input = createTemplateSchema.parse(req.body);
      const template = await prisma.emailTemplate.create({ data: input });
      ApiResponse.created(res, template, 'Template created');
    } catch (error) { next(error); }
  }

  /** PUT /api/admin/templates/:id */
  static async updateTemplate(req: Request, res: Response, next: NextFunction) {
    try {
      const input = updateTemplateSchema.parse(req.body);
      const template = await prisma.emailTemplate.update({ where: { id: req.params.id as string }, data: input });
      ApiResponse.success(res, template, 'Template updated');
    } catch (error) { next(error); }
  }

  /** DELETE /api/admin/templates/:id */
  static async deleteTemplate(req: Request, res: Response, next: NextFunction) {
    try {
      await prisma.emailTemplate.delete({ where: { id: req.params.id as string } });
      ApiResponse.success(res, null, 'Template deleted');
    } catch (error) { next(error); }
  }
}
