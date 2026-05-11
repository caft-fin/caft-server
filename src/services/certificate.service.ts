// ─────────────────────────────────────────────────────────
// CAFT Academy — Certificate Service
// Generates PDF certificates for course completion
// ─────────────────────────────────────────────────────────

import PDFDocument from 'pdfkit';
import { CourseMediaService } from './courseMedia.service';
import { env } from '../config/env';

export class CertificateService {
  /**
   * Generate a certificate PDF buffer
   */
  static async generateCertificatePDF(
    userName: string,
    courseTitle: string,
    certificateId: string,
    completedAt: Date
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        // Create a new PDF document (landscape mode for certificate)
        const doc = new PDFDocument({
          layout: 'landscape',
          size: 'A4',
          margin: 50,
        });

        const buffers: Buffer[] = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => resolve(Buffer.concat(buffers)));
        doc.on('error', reject);

        // --- Certificate Design ---
        
        // Background border
        doc.rect(20, 20, doc.page.width - 40, doc.page.height - 40).stroke('#3b82f6'); // Blue border
        doc.rect(25, 25, doc.page.width - 50, doc.page.height - 50).stroke('#1e3a8a'); // Darker blue inner border

        // Header
        doc.font('Helvetica-Bold')
           .fontSize(40)
           .fillColor('#1e3a8a')
           .text('CERTIFICATE OF COMPLETION', { align: 'center' })
           .moveDown(0.5);

        // Subtitle
        doc.font('Helvetica')
           .fontSize(16)
           .fillColor('#4b5563')
           .text('This is to certify that', { align: 'center' })
           .moveDown(0.5);

        // User Name
        doc.font('Helvetica-Bold')
           .fontSize(30)
           .fillColor('#111827')
           .text(userName.toUpperCase(), { align: 'center' })
           .moveDown(0.5);

        // Action
        doc.font('Helvetica')
           .fontSize(16)
           .fillColor('#4b5563')
           .text('has successfully completed the course', { align: 'center' })
           .moveDown(0.5);

        // Course Title
        doc.font('Helvetica-Bold')
           .fontSize(24)
           .fillColor('#3b82f6')
           .text(courseTitle, { align: 'center' })
           .moveDown(1.5);

        // Footer details
        const dateStr = completedAt.toLocaleDateString('en-US', {
          year: 'numeric', month: 'long', day: 'numeric'
        });

        doc.font('Helvetica')
           .fontSize(12)
           .fillColor('#6b7280')
           .text(`Date of Issue: ${dateStr}`, 100, doc.page.height - 120);

        doc.text(`Certificate ID: ${certificateId}`, 100, doc.page.height - 100);

        // Signature placeholder
        doc.font('Helvetica-Bold')
           .fontSize(14)
           .fillColor('#111827')
           .text(env.APP_NAME, doc.page.width - 250, doc.page.height - 120, { align: 'center' });
           
        doc.font('Helvetica')
           .fontSize(12)
           .fillColor('#6b7280')
           .text('Authorized Signature', doc.page.width - 250, doc.page.height - 100, { align: 'center' });

        // Finalize PDF
        doc.end();
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Generate and upload certificate to S3
   */
  static async issueCertificate(
    userId: string,
    courseId: string,
    userName: string,
    courseTitle: string,
    certificateId: string,
    completedAt: Date
  ) {
    try {
      // 1. Generate PDF
      const pdfBuffer = await this.generateCertificatePDF(userName, courseTitle, certificateId, completedAt);
      
      // 2. Upload to S3
      const s3Result = await CourseMediaService.uploadCertificate(courseId, certificateId, pdfBuffer);
      
      return s3Result.publicUrl;
    } catch (error) {
      console.error('Error issuing certificate:', error);
      throw error;
    }
  }
}
