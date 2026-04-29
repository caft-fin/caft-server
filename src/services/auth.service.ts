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
import { generateOtp, addDays } from '../utils/helpers';
import { EmailService } from './email.service';

export class AuthService {
  /**
   * Initiate login by sending OTP to an EXISTING user's email.
   * No self-registration — users must be created by an admin first.
   */
  static async initiateLogin(email: string) {
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user) {
      throw new AppError('No account found with this email. Contact your administrator.', 404);
    }

    if (!user.isActive) throw new AppError('Account is deactivated. Contact support.', 403);

    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    // Invalidate old OTPs
    await prisma.otpToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    await prisma.otpToken.create({ data: { userId: user.id, code: otp, expiresAt } });
    await EmailService.sendOtpEmail(email, otp, user.name);

    return { message: `OTP sent to ${email}` };
  }

  /**
   * Verify OTP and return JWT tokens
   */
  static async verifyOtp(email: string, otpCode: string) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new AppError('User not found', 404);

    const otpToken = await prisma.otpToken.findFirst({
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

    await prisma.otpToken.update({ where: { id: otpToken.id }, data: { usedAt: new Date() } });
    const wasFirstLogin = !user.isEmailVerified;
    await prisma.user.update({ where: { id: user.id }, data: { isEmailVerified: true, lastLoginAt: new Date() } });

    const tokens = AuthService.generateTokens(user);
    await prisma.refreshToken.create({ data: { userId: user.id, token: tokens.refreshToken, expiresAt: addDays(new Date(), 7) } });

    if (wasFirstLogin) await EmailService.sendWelcomeEmail(email, user.name);

    return {
      user: {
        id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl,
        role: user.role, isSuperAdmin: user.isSuperAdmin,
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

    const accessToken = jwt.sign(
      {
        userId: storedToken.user.id, email: storedToken.user.email,
        role: storedToken.user.role, isSuperAdmin: storedToken.user.isSuperAdmin,
      } as JwtPayload,
      env.JWT_ACCESS_SECRET,
      { expiresIn: env.JWT_ACCESS_EXPIRY as string as any }
    );
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
  private static generateTokens(user: { id: string; email: string; role: string; isSuperAdmin: boolean }) {
    const payload: JwtPayload = {
      userId: user.id, email: user.email,
      role: user.role as 'USER' | 'ADMIN',
      isSuperAdmin: user.isSuperAdmin,
    };
    const accessToken = jwt.sign(payload, env.JWT_ACCESS_SECRET, { expiresIn: env.JWT_ACCESS_EXPIRY as string as any });
    const refreshToken = uuidv4();
    return { accessToken, refreshToken };
  }
}
