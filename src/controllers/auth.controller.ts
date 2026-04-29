// ─────────────────────────────────────────────────────────
// CAFT Financial — Auth Controller
// ─────────────────────────────────────────────────────────

import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service';
import { ApiResponse } from '../utils/apiResponse';
import { loginSchema, verifyOtpSchema, adminLoginSchema, refreshTokenSchema } from '../utils/validators';
import { AuthenticatedRequest } from '../types';

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
      ApiResponse.success(res, result, 'Login successful');
    } catch (error) { next(error); }
  }

  static async adminLogin(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, password } = adminLoginSchema.parse(req.body);
      const result = await AuthService.adminLogin(email, password);
      ApiResponse.success(res, result, 'Admin login successful');
    } catch (error) { next(error); }
  }

  static async refresh(req: Request, res: Response, next: NextFunction) {
    try {
      const { refreshToken } = refreshTokenSchema.parse(req.body);
      const result = await AuthService.refreshAccessToken(refreshToken);
      ApiResponse.success(res, result, 'Token refreshed');
    } catch (error) { next(error); }
  }

  static async logout(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { refreshToken } = refreshTokenSchema.parse(req.body);
      await AuthService.logout(refreshToken);
      ApiResponse.success(res, null, 'Logged out successfully');
    } catch (error) { next(error); }
  }
}
