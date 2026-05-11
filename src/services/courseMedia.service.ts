// ─────────────────────────────────────────────────────────
// CAFT Academy — Course Media S3 Service
// ─────────────────────────────────────────────────────────

import { S3Client, PutObjectCommand, GetObjectCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env';
import { AppError } from '../utils/apiResponse';
import crypto from 'crypto';

// Use validated env vars
const COURSE_BUCKET = env.S3_COURSE_BUCKET;
const region = env.AWS_REGION;
const CLOUDFRONT_DOMAIN = env.CLOUDFRONT_DOMAIN;

const s3Client = new S3Client({
  region,
  credentials: {
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
  },
});

export class CourseMediaService {
  // ── Upload URLs ────────────────────────────────────────

  /**
   * Generate a pre-signed upload URL for course media
   * @param courseId Course ID for folder structure
   * @param folder  Subfolder: 'thumbnails' | 'preview_videos' | 'full_videos' | 'certificates'
   * @param filename Original filename
   * @param contentType MIME type
   */
  static async getUploadUrl(
    courseId: string,
    folder: 'thumbnails' | 'preview_videos' | 'full_videos' | 'certificates',
    filename: string,
    contentType: string,
  ) {
    try {
      const ext = filename.split('.').pop() || 'mp4';
      const uniqueId = crypto.randomBytes(12).toString('hex');
      const fileKey = `courses/${courseId}/${folder}/${uniqueId}.${ext}`;

      const command = new PutObjectCommand({
        Bucket: COURSE_BUCKET,
        Key: fileKey,
        ContentType: contentType,
      });

      const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 }); // 1 hour

      return {
        uploadUrl,
        fileKey,
        publicUrl: CourseMediaService.getPublicUrl(fileKey),
      };
    } catch (error: any) {
      console.error('Course media upload URL error:', error);
      throw new AppError('Failed to generate upload URL', 500);
    }
  }

  /**
   * Generate a pre-signed upload URL for user avatar
   */
  static async getUserAvatarUploadUrl(userId: string, filename: string, contentType: string) {
    try {
      const ext = filename.split('.').pop() || 'jpg';
      const uniqueId = crypto.randomBytes(8).toString('hex');
      const fileKey = `users/${userId}/avatars/${uniqueId}.${ext}`;

      const command = new PutObjectCommand({
        Bucket: COURSE_BUCKET,
        Key: fileKey,
        ContentType: contentType,
      });

      const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 });

      return {
        uploadUrl,
        fileKey,
        publicUrl: CourseMediaService.getPublicUrl(fileKey),
      };
    } catch (error: any) {
      console.error('User avatar upload URL error:', error);
      throw new AppError('Failed to generate upload URL', 500);
    }
  }

  // ── Download / Stream URLs ─────────────────────────────

  /**
   * Generate a secure stream URL for a video.
   * Uses CloudFront signed URLs if configured, otherwise falls back to S3 presigned URLs.
   * 
   * SECURITY: All URLs are time-limited and signed. Nothing is publicly accessible.
   * 
   * @param s3Key The S3 object key
   * @param expiresInSeconds URL lifetime (default 4 hours)
   */
  static async getStreamUrl(s3Key: string, expiresInSeconds = 14400) {
    try {
      // If CloudFront is configured with signing credentials, use signed URLs
      if (CLOUDFRONT_DOMAIN && env.CLOUDFRONT_KEY_PAIR_ID && env.CLOUDFRONT_PRIVATE_KEY) {
        return CourseMediaService.getCloudFrontSignedUrl(s3Key, expiresInSeconds);
      }

      // If CloudFront is configured WITHOUT signing (not recommended for production),
      // still use S3 presigned to maintain security
      if (CLOUDFRONT_DOMAIN) {
        console.warn('⚠️ CloudFront configured without signing credentials. Falling back to S3 presigned URLs for security.');
      }

      // Fallback: S3 presigned GET URL (always secure)
      const command = new GetObjectCommand({
        Bucket: COURSE_BUCKET,
        Key: s3Key,
      });

      return await getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
    } catch (error: any) {
      console.error('Stream URL generation error:', error);
      throw new AppError('Failed to generate stream URL', 500);
    }
  }

  /**
   * Generate a CloudFront signed URL.
   * 
   * Uses RSA-SHA1 signature with the configured CloudFront key pair.
   * This ensures content is only accessible with a valid, time-limited signature.
   */
  private static getCloudFrontSignedUrl(s3Key: string, expiresInSeconds: number): string {
    const url = `https://${CLOUDFRONT_DOMAIN}/${s3Key}`;
    const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
    const keyPairId = env.CLOUDFRONT_KEY_PAIR_ID;
    const privateKey = env.CLOUDFRONT_PRIVATE_KEY.replace(/\\n/g, '\n'); // Handle escaped newlines

    // Build CloudFront canned policy
    const policy = JSON.stringify({
      Statement: [{
        Resource: url,
        Condition: {
          DateLessThan: { 'AWS:EpochTime': expires },
        },
      }],
    });

    // Sign the policy with RSA-SHA1
    const signer = crypto.createSign('RSA-SHA1');
    signer.update(policy);
    const signature = signer.sign(privateKey, 'base64')
      .replace(/\+/g, '-')
      .replace(/=/g, '_')
      .replace(/\//g, '~');

    return `${url}?Expires=${expires}&Signature=${signature}&Key-Pair-Id=${keyPairId}`;
  }

  /**
   * Generate a presigned URL for certificate download
   */
  static async getCertificateUrl(s3Key: string) {
    return CourseMediaService.getStreamUrl(s3Key, 86400); // 24 hour expiry
  }

  // ── Upload Certificate PDF ─────────────────────────────

  /**
   * Upload a generated certificate PDF to S3
   * @param courseId Course ID
   * @param certificateId Unique certificate identifier
   * @param pdfBuffer The PDF content as a Buffer
   */
  static async uploadCertificate(courseId: string, certificateId: string, pdfBuffer: Buffer) {
    try {
      const fileKey = `courses/${courseId}/certificates/${certificateId}.pdf`;

      const command = new PutObjectCommand({
        Bucket: COURSE_BUCKET,
        Key: fileKey,
        Body: pdfBuffer,
        ContentType: 'application/pdf',
        ContentDisposition: `attachment; filename="certificate-${certificateId}.pdf"`,
      });

      await s3Client.send(command);

      return {
        fileKey,
        publicUrl: CourseMediaService.getPublicUrl(fileKey),
      };
    } catch (error: any) {
      console.error('Certificate upload error:', error);
      throw new AppError('Failed to upload certificate', 500);
    }
  }

  // ── Helpers ────────────────────────────────────────────

  /**
   * Get the public URL for a given S3 key
   * Uses CloudFront if configured, otherwise S3 direct URL
   * NOTE: For non-video assets (thumbnails, etc.) that don't need signing
   */
  static getPublicUrl(fileKey: string): string {
    if (CLOUDFRONT_DOMAIN) {
      return `https://${CLOUDFRONT_DOMAIN}/${fileKey}`;
    }
    return `https://${COURSE_BUCKET}.s3.${region}.amazonaws.com/${fileKey}`;
  }

  /**
   * Verify the course bucket exists and is accessible
   */
  static async verifyBucketAccess(): Promise<boolean> {
    try {
      await s3Client.send(new HeadBucketCommand({ Bucket: COURSE_BUCKET }));
      return true;
    } catch {
      console.warn(`⚠️ Course media bucket '${COURSE_BUCKET}' is not accessible. Video features will be limited.`);
      return false;
    }
  }
}
