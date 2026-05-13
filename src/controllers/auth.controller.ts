// ─────────────────────────────────────────────────────────
// CAFT Financial — Auth Controller
// ─────────────────────────────────────────────────────────

import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service';
import { ApiResponse } from '../utils/apiResponse';
import { loginSchema, verifyOtpSchema, adminLoginSchema } from '../utils/validators';
import { AuthenticatedRequest } from '../types';
import { env } from '../config/env';

// ── Cookie helpers ────────────────────────────────────────

/** 15 min — matches JWT_ACCESS_EXPIRY default */
const ACCESS_COOKIE_TTL = 15 * 60 * 1000;
/** 7 days — matches JWT_REFRESH_EXPIRY default */
const REFRESH_COOKIE_TTL = 7 * 24 * 60 * 60 * 1000;

const COOKIE_BASE = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
};

function setAuthCookies(res: Response, accessToken: string, refreshToken: string | null): void {
  res.cookie('caft_access', accessToken, { ...COOKIE_BASE, maxAge: ACCESS_COOKIE_TTL });
  if (refreshToken !== null) {
    res.cookie('caft_refresh', refreshToken, { ...COOKIE_BASE, maxAge: REFRESH_COOKIE_TTL });
  }
}

function clearAuthCookies(res: Response): void {
  res.clearCookie('caft_access', COOKIE_BASE);
  res.clearCookie('caft_refresh', COOKIE_BASE);
}

// ── Controller ────────────────────────────────────────────

export class AuthController {
  static async login(req: Request, res: Response, next: NextFunction) {
    try {
      const { email } = loginSchema.parse(req.body);
      const result = await AuthService.initiateLogin(email);
      ApiResponse.success(res, result, 'OTP sent successfully');
    } catch (error) { next(error); }
  }

  static async verifyOtp(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, otp } = verifyOtpSchema.parse(req.body);
      const result = await AuthService.verifyOtp(email, otp);
      // Tokens go into httpOnly cookies — never in the response body
      setAuthCookies(res, result.accessToken, result.refreshToken);
      ApiResponse.success(res, { user: result.user }, 'Login successful');
    } catch (error) { next(error); }
  }

  static async adminLogin(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, password } = adminLoginSchema.parse(req.body);
      const result = await AuthService.adminLogin(email, password);
      setAuthCookies(res, result.accessToken, result.refreshToken);
      ApiResponse.success(res, { user: result.user }, 'Admin login successful');
    } catch (error) { next(error); }
  }

  static async refresh(req: Request, res: Response, next: NextFunction) {
    try {
      // Cookie-first; accept body token as fallback for non-cookie API clients
      const cookies = req.cookies as Record<string, string | undefined>;
      const refreshToken = cookies?.caft_refresh ?? (req.body?.refreshToken as string | undefined);

      if (!refreshToken) {
        ApiResponse.unauthorized(res, 'Refresh token is required');
        return;
      }

      const result = await AuthService.refreshAccessToken(refreshToken);
      // Rotate the access cookie only; the refresh cookie stays valid until its own expiry
      setAuthCookies(res, result.accessToken, null);
      // Also return the token in the body so non-cookie clients can store it themselves
      ApiResponse.success(res, { accessToken: result.accessToken }, 'Token refreshed');
    } catch (error) { next(error); }
  }

  static async logout(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const cookies = req.cookies as Record<string, string | undefined>;
      const refreshToken = cookies?.caft_refresh ?? (req.body?.refreshToken as string | undefined);

      if (refreshToken) {
        // Best-effort DB revocation — don't block logout on failure
        await AuthService.logout(refreshToken).catch(() => {});
      }

      clearAuthCookies(res);
      ApiResponse.success(res, null, 'Logged out successfully');
    } catch (error) { next(error); }
  }
}
