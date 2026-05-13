// ─────────────────────────────────────────────────────────
// CAFT Financial — Upload Controller
// ─────────────────────────────────────────────────────────

import { Response, NextFunction } from 'express';
import { S3Service } from '../services/s3.service';
import { AuthenticatedRequest } from '../types';
import { ApiResponse, AppError } from '../utils/apiResponse';
import { z } from 'zod';

/** MIME types accepted for direct S3 uploads. */
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'application/pdf',
]);

const presignedUrlSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1),
});

export class UploadController {
  /**
   * POST /api/upload/presigned-url
   * Generate an S3 presigned URL for secure, direct-to-S3 client uploads.
   * Only admins can call this endpoint (enforced by route middleware).
   */
  static async getPresignedUrl(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { filename, contentType } = presignedUrlSchema.parse(req.body);

      if (!ALLOWED_MIME_TYPES.has(contentType)) {
        throw new AppError(
          `Unsupported content type '${contentType}'. Allowed types: ${[...ALLOWED_MIME_TYPES].join(', ')}`,
          415
        );
      }

      const credentials = await S3Service.getPresignedUploadUrl(filename, contentType);
      ApiResponse.success(res, credentials);
    } catch (error) { next(error); }
  }
}
