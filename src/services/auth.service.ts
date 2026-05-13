// ─────────────────────────────────────────────────────────
// CAFT Financial — Authentication Service
// ─────────────────────────────────────────────────────────

import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { env } from '../config/env';
import { prisma } from '../config/database';
import { JwtPayload } from '../types';
import { AppError } from '../utils/apiResponse';
import { generateOtp, generateReferralCode, addDays } from '../utils/helpers';
import { EmailService } from './email.service';
import { CacheService } from './cache.service';

interface TestAccountConfig {
  enabled: boolean;
  email: string;
  otp: string;
}

export class AuthService {
  /**
   * Get test account configuration.
   * Checks AdminSettings first (admin dashboard override), falls back to env vars.
   * Cached for 5 minutes to avoid DB hit on every login.
   */
  private static async getTestAccountConfig(): Promise<TestAccountConfig> {
    return CacheService.getOrSet<TestAccountConfig>('settings:test_account', 300, async () => {
      const settings = await prisma.adminSetting.findMany({
        where: { key: { in: ['testAccountEnabled', 'testAccountEmail', 'testAccountOtp'] } },
      });
      const settingsMap = Object.fromEntries(settings.map(s => [s.key, s.value]));

      return {
        enabled: settingsMap.testAccountEnabled !== undefined
          ? settingsMap.testAccountEnabled === 'true'
          : env.TEST_ACCOUNT_ENABLED === 'true',
        email: settingsMap.testAccountEmail || env.TEST_ACCOUNT_EMAIL,
        otp: settingsMap.testAccountOtp || env.TEST_ACCOUNT_OTP,
      };
    });
  }

  /**
   * Initiate login by sending OTP to the user's email.
   * If the email doesn't exist, auto-register the user first.
   */
  static async initiateLogin(email: string) {
    let user = await prisma.user.findUnique({ where: { email } });

    // Auto-register new users
    if (!user) {
      const namePart = email.split('@')[0].replace(/[._-]/g, ' ');
      const displayName = namePart
        .split(' ')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');

      user = await prisma.user.create({
        data: {
          email,
          name: displayName,
          role: 'USER',
          isActive: true,
          referralCode: generateReferralCode(displayName),
        },
      });
      console.log(`\n✅ New user auto-registered: ${email} (name: ${displayName})\n`);
    }

    if (!user.isActive) throw new AppError('Account is deactivated. Contact support.', 403);

    // Check if this is a configured test account
    const testConfig = await AuthService.getTestAccountConfig();
    const isTestAccount = testConfig.enabled && email === testConfig.email;
    const otp = isTestAccount ? testConfig.otp : generateOtp();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    // Invalidate old OTPs
    await prisma.otpToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    await prisma.otpToken.create({ data: { userId: user.id, code: otp, expiresAt } });

    // Print OTP to terminal in non-production environments only
    // In production, OTP must only travel via the SES email channel.
    if (env.NODE_ENV !== 'production') {
      console.log(`\n🔑 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`   OTP for ${email}: ${otp}`);
      console.log(`   Expires at: ${expiresAt.toLocaleTimeString()}`);
      if (isTestAccount) console.log(`   ⚙️  Test account mode (admin-configurable)`);
      console.log(`🔑 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    }

    // Send via email in background (don't block the response)
    EmailService.sendOtpEmail(email, otp, user.name).catch(err => {
      console.error(`❌ Background email sending failed for ${email}:`, err.message);
    });

    return { message: `OTP sent to ${email}` };
  }

  /**
   * Verify OTP and return JWT tokens
   */
  static async verifyOtp(email: string, otpCode: string) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new AppError('User not found', 404);

    // Check if this is a configured test account with matching OTP
    const testConfig = await AuthService.getTestAccountConfig();
    const isTestAccount = testConfig.enabled && email === testConfig.email && otpCode === testConfig.otp;

    let otpToken = null;
    if (!isTestAccount) {
      otpToken = await prisma.otpToken.findFirst({
        where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
      });

      if (!otpToken) throw new AppError('OTP expired. Request a new one.', 400);
      if (otpToken.attempts >= 5) {
        await prisma.otpToken.update({ where: { id: otpToken.id }, data: { usedAt: new Date() } });
        throw new AppError('Too many failed attempts.', 429);
      }

      if (otpToken.code !== otpCode) {
        await prisma.otpToken.update({ where: { id: otpToken.id }, data: { attempts: { increment: 1 } } });
        throw new AppError('Invalid OTP', 400);
      }
    }

    if (otpToken) {
      await prisma.otpToken.update({ where: { id: otpToken.id }, data: { usedAt: new Date() } });
    }
    const wasFirstLogin = !user.isEmailVerified;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        isEmailVerified: true,
        lastLoginAt: new Date(),
        totalVisits: { increment: 1 },
      },
    });

    const tokens = AuthService.generateTokens(user);
    await prisma.refreshToken.create({ data: { userId: user.id, token: tokens.refreshToken, expiresAt: addDays(new Date(), 7) } });

    if (wasFirstLogin) await EmailService.sendWelcomeEmail(email, user.name);

    return {
      user: {
        id: user.id, email: user.email, name: user.name, phone: user.phone,
        avatarUrl: user.avatarUrl, role: user.role, isSuperAdmin: user.isSuperAdmin,
        googleId: user.googleId, verifiedBy: user.googleId ? 'Google' : 'OTP',
        membershipLevel: user.kycVerified ? 'Premium Solaris' : 'Basic',
      },
      ...tokens,
    };
  }

  /**
   * Admin login with email/password
   */
  static async adminLogin(email: string, password: string) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.role !== 'ADMIN' || !user.passwordHash) throw new AppError('Invalid credentials', 401);

    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) throw new AppError('Invalid credentials', 401);

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const tokens = AuthService.generateTokens(user);
    await prisma.refreshToken.create({ data: { userId: user.id, token: tokens.refreshToken, expiresAt: addDays(new Date(), 7) } });

    return {
      user: { id: user.id, email: user.email, name: user.name, role: user.role, isSuperAdmin: user.isSuperAdmin },
      ...tokens,
    };
  }

  /**
   * Refresh access token using a valid refresh token
   */
  static async refreshAccessToken(refreshToken: string) {
    const storedToken = await prisma.refreshToken.findUnique({ where: { token: refreshToken }, include: { user: true } });
    if (!storedToken || storedToken.revokedAt || storedToken.expiresAt < new Date()) throw new AppError('Invalid refresh token', 401);

    const payload: JwtPayload = {
      userId: storedToken.user.id,
      email: storedToken.user.email,
      role: storedToken.user.role as 'USER' | 'ADMIN',
      isSuperAdmin: storedToken.user.isSuperAdmin,
    };

    const accessToken = jwt.sign(payload, env.JWT_ACCESS_SECRET, {
      expiresIn: env.JWT_ACCESS_EXPIRY,
    } as jwt.SignOptions);

    return { accessToken };
  }

  /**
   * Revoke a refresh token (logout)
   */
  static async logout(refreshToken: string): Promise<void> {
    await prisma.refreshToken.updateMany({ where: { token: refreshToken, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  /**
   * Generate access and refresh token pair
   */
  static generateTokens(user: { id: string; email: string; role: string; isSuperAdmin: boolean }) {
    const payload: JwtPayload = {
      userId: user.id, email: user.email,
      role: user.role as 'USER' | 'ADMIN',
      isSuperAdmin: user.isSuperAdmin,
    };
    const accessToken = jwt.sign(payload, env.JWT_ACCESS_SECRET, {
      expiresIn: env.JWT_ACCESS_EXPIRY,
    } as jwt.SignOptions);
    const refreshToken = uuidv4();
    return { accessToken, refreshToken };
  }
}
