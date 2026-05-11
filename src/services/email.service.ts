// ─────────────────────────────────────────────────────────
// CAFT Financial — Email Service (Amazon SES)
// ─────────────────────────────────────────────────────────

import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { env } from '../config/env';
import { formatCurrency } from '../utils/helpers';

let sesClient: SESv2Client;

function getSesClient(): SESv2Client {
  if (!sesClient) {
    // SES is explicitly configured in ap-south-2 (Hyderabad).
    const sesRegion = process.env.SES_REGION || 'ap-south-2';
    // Use dedicated SES credentials if provided (SES may be in a different AWS account),
    // otherwise fall back to the main AWS credentials.
    const accessKeyId = env.SES_ACCESS_KEY_ID || env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = env.SES_SECRET_ACCESS_KEY || env.AWS_SECRET_ACCESS_KEY;
    sesClient = new SESv2Client({
      region: sesRegion,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });
  }
  return sesClient;
}

async function sendEmail(to: string, subject: string, htmlBody: string): Promise<void> {
  try {
    const client = getSesClient();
    await client.send(new SendEmailCommand({
      // Wrap name in quotes to prevent parsing errors with spaces
      FromEmailAddress: `"${env.SES_FROM_NAME}" <${env.SES_FROM_EMAIL}>`,
      Destination: { ToAddresses: [to] },
      Content: {
        Simple: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: { Html: { Data: htmlBody, Charset: 'UTF-8' } },
        },
      },
    }));
    console.log(`📧 Email sent to ${to}: ${subject}`);
  } catch (error) {
    const err = error as Error;
    console.error(`❌ Failed to send email to ${to}:`, err.message);
    
    if (err.message.includes('not verified') || err.message.includes('Sandbox')) {
      console.warn('⚠️  SES AUTHENTICATION ISSUE: This account is in SES Sandbox mode.');
      console.warn(`   Make sure both "${env.SES_FROM_EMAIL}" and "${to}" are verified in the AWS Console (Region: ${env.AWS_REGION}).`);
      console.warn('   To send to any email, request Production Access in the AWS SES dashboard.');
    }
    // Don't throw - email failures shouldn't break the flow
  }
}

export class EmailService {
  static async sendOtpEmail(to: string, otp: string, name: string): Promise<void> {
    const html = `
<!DOCTYPE html><html><body style="font-family:'Inter',sans-serif;background:#f9fafb;padding:40px 0;">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:40px;box-shadow:0 4px 24px rgba(0,0,0,0.06);">
  <h1 style="color:#E67E22;font-size:24px;margin:0 0 8px;">CAFT Financial</h1>
  <p style="color:#6b7280;margin:0 0 24px;">Secure Login Verification</p>
  <p style="color:#111827;">Hi ${name},</p>
  <p style="color:#374151;">Your one-time password is:</p>
  <div style="background:linear-gradient(135deg,#E67E22,#F39C12);border-radius:12px;padding:24px;text-align:center;margin:24px 0;">
    <span style="font-size:36px;font-weight:800;color:#fff;letter-spacing:8px;">${otp}</span>
  </div>
  <p style="color:#6b7280;font-size:14px;">This code expires in 5 minutes. Do not share it with anyone.</p>
  <hr style="border:none;border-top:1px solid #f3f4f6;margin:24px 0;">
  <p style="color:#9ca3af;font-size:12px;">If you didn't request this, please ignore this email.</p>
</div></body></html>`;
    await sendEmail(to, `${otp} is your CAFT Financial login code`, html);
  }

  static async sendWelcomeEmail(to: string, name: string): Promise<void> {
    const html = `
<!DOCTYPE html><html><body style="font-family:'Inter',sans-serif;background:#f9fafb;padding:40px 0;">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:40px;box-shadow:0 4px 24px rgba(0,0,0,0.06);">
  <h1 style="color:#E67E22;font-size:28px;margin:0 0 16px;">Welcome to CAFT Financial! 🎉</h1>
  <p style="color:#374151;">Hi ${name},</p>
  <p style="color:#374151;">Your account is now active. Start tracking your finances, managing investments, and growing your wealth.</p>
  <a href="${env.APP_URL}/dashboard" style="display:inline-block;background:linear-gradient(135deg,#E67E22,#F39C12);color:#fff;padding:14px 32px;border-radius:12px;text-decoration:none;font-weight:700;margin:24px 0;">Go to Dashboard</a>
  <p style="color:#6b7280;font-size:14px;">Need help? Reply to this email or visit our support center.</p>
</div></body></html>`;
    await sendEmail(to, 'Welcome to CAFT Financial', html);
  }

  static async sendPaymentSuccessEmail(to: string, name: string, amount: number, planName: string, orderId: string): Promise<void> {
    const html = `
<!DOCTYPE html><html><body style="font-family:'Inter',sans-serif;background:#f9fafb;padding:40px 0;">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:40px;box-shadow:0 4px 24px rgba(0,0,0,0.06);">
  <div style="text-align:center;margin-bottom:24px;">
    <div style="width:64px;height:64px;background:#dcfce7;border-radius:50%;margin:0 auto;display:flex;align-items:center;justify-content:center;">
      <span style="font-size:32px;">✓</span>
    </div>
  </div>
  <h1 style="color:#111827;font-size:24px;text-align:center;margin:0 0 8px;">Payment Successful</h1>
  <p style="color:#6b7280;text-align:center;margin:0 0 24px;">Your payment has been processed</p>
  <div style="background:#f9fafb;border-radius:12px;padding:20px;margin:16px 0;">
    <div style="display:flex;justify-content:space-between;margin-bottom:12px;"><span style="color:#6b7280;">Amount</span><span style="color:#111827;font-weight:700;">${formatCurrency(amount)}</span></div>
    <div style="display:flex;justify-content:space-between;margin-bottom:12px;"><span style="color:#6b7280;">Plan</span><span style="color:#111827;font-weight:700;">${planName}</span></div>
    <div style="display:flex;justify-content:space-between;"><span style="color:#6b7280;">Order ID</span><span style="color:#111827;font-weight:700;">${orderId}</span></div>
  </div>
  <p style="color:#6b7280;font-size:14px;text-align:center;">Thank you for choosing CAFT Financial, ${name}!</p>
</div></body></html>`;
    await sendEmail(to, `Payment confirmed — ${formatCurrency(amount)}`, html);
  }

  static async sendPaymentFailureEmail(to: string, name: string, amount: number, reason: string): Promise<void> {
    const html = `
<!DOCTYPE html><html><body style="font-family:'Inter',sans-serif;background:#f9fafb;padding:40px 0;">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:40px;box-shadow:0 4px 24px rgba(0,0,0,0.06);">
  <div style="text-align:center;margin-bottom:24px;">
    <div style="width:64px;height:64px;background:#fef2f2;border-radius:50%;margin:0 auto;display:flex;align-items:center;justify-content:center;">
      <span style="font-size:32px;">✕</span>
    </div>
  </div>
  <h1 style="color:#dc2626;font-size:24px;text-align:center;">Payment Failed</h1>
  <p style="color:#374151;">Hi ${name}, your payment of ${formatCurrency(amount)} could not be processed.</p>
  <p style="color:#6b7280;font-size:14px;"><strong>Reason:</strong> ${reason}</p>
  <a href="${env.APP_URL}/dashboard/management" style="display:inline-block;background:#E67E22;color:#fff;padding:14px 32px;border-radius:12px;text-decoration:none;font-weight:700;margin:24px 0;">Retry Payment</a>
</div></body></html>`;
    await sendEmail(to, 'Payment failed — action required', html);
  }

  static async sendCampaignEmail(to: string, subject: string, htmlContent: string): Promise<void> {
    await sendEmail(to, subject, htmlContent);
  }

  static async sendSubscriptionRenewalEmail(to: string, name: string, planName: string, renewalDate: string): Promise<void> {
    const html = `
<!DOCTYPE html><html><body style="font-family:'Inter',sans-serif;background:#f9fafb;padding:40px 0;">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:40px;">
  <h1 style="color:#E67E22;font-size:24px;">Subscription Renewal Reminder</h1>
  <p style="color:#374151;">Hi ${name}, your <strong>${planName}</strong> subscription will renew on <strong>${renewalDate}</strong>.</p>
  <a href="${env.APP_URL}/dashboard/management" style="display:inline-block;background:#E67E22;color:#fff;padding:14px 32px;border-radius:12px;text-decoration:none;font-weight:700;margin:24px 0;">Manage Subscription</a>
</div></body></html>`;
    await sendEmail(to, `Subscription renewal — ${planName}`, html);
  }

  static async sendSubscriptionActivatedEmail(to: string, name: string, planName: string, periodEnd: string): Promise<void> {
    const html = `
<!DOCTYPE html><html><body style="font-family:'Inter',sans-serif;background:#f9fafb;padding:40px 0;">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:40px;box-shadow:0 4px 24px rgba(0,0,0,0.06);">
  <div style="text-align:center;margin-bottom:24px;">
    <div style="width:64px;height:64px;background:#dbeafe;border-radius:50%;margin:0 auto;display:flex;align-items:center;justify-content:center;">
      <span style="font-size:32px;">🚀</span>
    </div>
  </div>
  <h1 style="color:#111827;font-size:24px;text-align:center;margin:0 0 8px;">Subscription Activated</h1>
  <p style="color:#6b7280;text-align:center;margin:0 0 24px;">Your plan is now live</p>
  <div style="background:#f9fafb;border-radius:12px;padding:20px;margin:16px 0;">
    <div style="display:flex;justify-content:space-between;margin-bottom:12px;"><span style="color:#6b7280;">Plan</span><span style="color:#111827;font-weight:700;">${planName}</span></div>
    <div style="display:flex;justify-content:space-between;"><span style="color:#6b7280;">Active Until</span><span style="color:#111827;font-weight:700;">${periodEnd}</span></div>
  </div>
  <p style="color:#374151;text-align:center;">Hi ${name}, your <strong>${planName}</strong> subscription is now active. Enjoy full access to all premium features!</p>
  <div style="text-align:center;">
    <a href="${env.APP_URL}/dashboard" style="display:inline-block;background:linear-gradient(135deg,#E67E22,#F39C12);color:#fff;padding:14px 32px;border-radius:12px;text-decoration:none;font-weight:700;margin:24px 0;">Go to Dashboard</a>
  </div>
</div></body></html>`;
    await sendEmail(to, `Your ${planName} subscription is now active! 🚀`, html);
  }

  static async sendSubscriptionCancelledEmail(to: string, name: string, planName: string): Promise<void> {
    const html = `
<!DOCTYPE html><html><body style="font-family:'Inter',sans-serif;background:#f9fafb;padding:40px 0;">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:40px;box-shadow:0 4px 24px rgba(0,0,0,0.06);">
  <div style="text-align:center;margin-bottom:24px;">
    <div style="width:64px;height:64px;background:#fef3c7;border-radius:50%;margin:0 auto;display:flex;align-items:center;justify-content:center;">
      <span style="font-size:32px;">⚠️</span>
    </div>
  </div>
  <h1 style="color:#111827;font-size:24px;text-align:center;">Subscription Cancelled</h1>
  <p style="color:#374151;text-align:center;">Hi ${name}, your <strong>${planName}</strong> subscription has been cancelled.</p>
  <p style="color:#6b7280;font-size:14px;text-align:center;">You'll retain access until the end of your current billing period. After that, your account will revert to the free tier.</p>
  <div style="text-align:center;">
    <a href="${env.APP_URL}/pricing" style="display:inline-block;background:#E67E22;color:#fff;padding:14px 32px;border-radius:12px;text-decoration:none;font-weight:700;margin:24px 0;">Resubscribe</a>
  </div>
  <p style="color:#9ca3af;font-size:12px;text-align:center;">Changed your mind? You can resubscribe anytime.</p>
</div></body></html>`;
    await sendEmail(to, `Your ${planName} subscription has been cancelled`, html);
  }

  static async sendSubscriptionChargedEmail(to: string, name: string, planName: string, amount: number, paymentId: string): Promise<void> {
    const html = `
<!DOCTYPE html><html><body style="font-family:'Inter',sans-serif;background:#f9fafb;padding:40px 0;">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:40px;box-shadow:0 4px 24px rgba(0,0,0,0.06);">
  <div style="text-align:center;margin-bottom:24px;">
    <div style="width:64px;height:64px;background:#dcfce7;border-radius:50%;margin:0 auto;display:flex;align-items:center;justify-content:center;">
      <span style="font-size:32px;">✓</span>
    </div>
  </div>
  <h1 style="color:#111827;font-size:24px;text-align:center;margin:0 0 8px;">Renewal Payment Received</h1>
  <p style="color:#6b7280;text-align:center;margin:0 0 24px;">Your subscription has been renewed</p>
  <div style="background:#f9fafb;border-radius:12px;padding:20px;margin:16px 0;">
    <div style="display:flex;justify-content:space-between;margin-bottom:12px;"><span style="color:#6b7280;">Amount</span><span style="color:#111827;font-weight:700;">${formatCurrency(amount)}</span></div>
    <div style="display:flex;justify-content:space-between;margin-bottom:12px;"><span style="color:#6b7280;">Plan</span><span style="color:#111827;font-weight:700;">${planName}</span></div>
    <div style="display:flex;justify-content:space-between;"><span style="color:#6b7280;">Payment ID</span><span style="color:#111827;font-weight:700;">${paymentId}</span></div>
  </div>
  <p style="color:#6b7280;font-size:14px;text-align:center;">Thank you for being a CAFT Financial subscriber, ${name}!</p>
</div></body></html>`;
    await sendEmail(to, `Renewal receipt — ${formatCurrency(amount)} for ${planName}`, html);
  }
}
