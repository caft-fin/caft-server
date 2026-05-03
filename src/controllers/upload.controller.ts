// ─────────────────────────────────────────────────────────
// CAFT Financial — Upload Controller
// ─────────────────────────────────────────────────────────

import { Response, NextFunction } from 'express';
import { S3Service } from '../services/s3.service';
import { AuthenticatedRequest } from '../types';
import { z } from 'zod';

const presignedUrlSchema = z.object({
  filename: z.string().min(1),
  contentType: z.string().min(1),
});

export class UploadController {
  /**
   * POST /api/upload/presigned-url
   * Generate an S3 presigned URL for secure, direct-to-S3 client uploads
   */
  static async getPresignedUrl(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { filename, contentType } = presignedUrlSchema.parse(req.body);
      
      const credentials = await S3Service.getPresignedUploadUrl(filename, contentType);

      res.json({
        status: 'success',
        data: credentials,
      });
    } catch (error) { next(error); }
  }
}
