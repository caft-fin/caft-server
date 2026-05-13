// ─────────────────────────────────────────────────────────
// CAFT Financial — AWS S3 Service
// ─────────────────────────────────────────────────────────

import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env';
import { AppError } from '../utils/apiResponse';
import crypto from 'crypto';

// C2: Read bucket name from env (defaults already set in env.ts)
const bucketName = env.S3_COURSE_BUCKET;

// C4: env.AWS_REGION already defaults to 'ap-south-1' in env.ts — no hardcoded fallback
const region = env.AWS_REGION;

// C3: Pass explicit credentials only when both env vars are present.
// On EC2/ECS, leave credentials unset so the AWS SDK uses the instance/task role instead.
const s3Client = new S3Client({
  region,
  ...(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
    ? {
        credentials: {
          accessKeyId: env.AWS_ACCESS_KEY_ID,
          secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
        },
      }
    : {}),
});

export class S3Service {
  /**
   * Generate a pre-signed URL for client-side upload to S3
   * @param filename Original filename from the user
   * @param contentType MIME type of the file (e.g., 'image/jpeg')
   */
  static async getPresignedUploadUrl(filename: string, contentType: string) {
    try {
      // Generate a unique file key
      const ext = filename.split('.').pop() || 'png';
      const fileKey = `products/${crypto.randomBytes(16).toString('hex')}.${ext}`;

      const command = new PutObjectCommand({
        Bucket: bucketName,
        Key: fileKey,
        ContentType: contentType,
        // Since we enabled public read, we don't need ACL: 'public-read' necessarily
        // but it can be specified if needed. 
      });

      // URL expires in 15 minutes (900 seconds)
      const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 });
      const publicUrl = `https://${bucketName}.s3.${region}.amazonaws.com/${fileKey}`;

      return {
        uploadUrl,
        publicUrl,
        fileKey,
      };
    } catch (error: any) {
      console.error('S3 presigned URL error:', error);
      throw new AppError('Failed to generate upload URL', 500);
    }
  }
}
