// ─────────────────────────────────────────────────────────
// CAFT Financial — Auth Routes
// ─────────────────────────────────────────────────────────

import { Router, Request, Response, NextFunction } from 'express';
import { AuthController } from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth';
import { authLimiter } from '../middleware/rateLimiter';
import { GoogleOAuthService } from '../services/google-oauth.service';
import { env } from '../config/env';

const router = Router();

router.post('/login', authLimiter, AuthController.login);
router.post('/verify-otp', authLimiter, AuthController.verifyOtp);
router.post('/admin/login', authLimiter, AuthController.adminLogin);
router.post('/refresh', AuthController.refresh);
// Logout does not require a valid access token — the refresh cookie is enough for revocation,
// and users must be able to log out even when their access token has already expired.
router.post('/logout', AuthController.logout);

// ── Google OAuth2 ─────────────────────────────────────────

/** GET /api/auth/google — Redirect user to Google consent screen */
router.get('/google', (_req: Request, res: Response, next: NextFunction) => {
  try {
    const url = GoogleOAuthService.getAuthUrl();
    res.redirect(url);
  } catch (error) { next(error); }
});

/** GET /api/auth/google/callback — Handle Google redirect with auth code */
router.get('/google/callback', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const code = req.query.code as string;
    if (!code) {
      return res.redirect(`${env.APP_URL}/login?error=google_no_code`);
    }

    const result = await GoogleOAuthService.handleCallback(code);

    // Set httpOnly auth cookies before redirecting — tokens never appear in the URL.
    const isProduction = env.NODE_ENV === 'production';
    const cookieBase = { httpOnly: true, secure: isProduction, sameSite: 'lax' as const, path: '/' };
    res.cookie('caft_access', result.accessToken, { ...cookieBase, maxAge: 15 * 60 * 1000 });
    res.cookie('caft_refresh', result.refreshToken, { ...cookieBase, maxAge: 7 * 24 * 60 * 60 * 1000 });

    // Pass only the non-sensitive user object so the callback page can populate Zustand
    const params = new URLSearchParams({ user: JSON.stringify(result.user) });
    res.redirect(`${env.APP_URL}/login/google-callback?${params.toString()}`);
  } catch (error: any) {
    console.error('❌ Google OAuth callback error:', error?.message || error);
    res.redirect(`${env.APP_URL}/login?error=google_auth_failed`);
  }
});

export default router;
