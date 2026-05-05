// ─────────────────────────────────────────────────────────
// CAFT Financial — Google OAuth2 Service
//
// Lightweight OAuth2 implementation without passport.
// Uses Google's token + userinfo endpoints directly.
// ─────────────────────────────────────────────────────────

import { env } from '../config/env';
import { prisma } from '../config/database';
import { AppError } from '../utils/apiResponse';
import { AuthService } from './auth.service';
import { generateReferralCode } from '../utils/helpers';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

export class GoogleOAuthService {
  /**
   * Build the Google OAuth2 consent URL.
   * The frontend redirects the user's browser here.
   */
  static getAuthUrl(): string {
    if (!env.GOOGLE_CLIENT_ID) {
      throw new AppError('Google OAuth is not configured', 500);
    }

    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      redirect_uri: env.GOOGLE_CALLBACK_URL,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'offline',
      prompt: 'select_account',
    });

    return `${GOOGLE_AUTH_URL}?${params.toString()}`;
  }

  /**
   * Exchange the authorization code for tokens,
   * fetch the user's profile, upsert in DB, and return JWT tokens.
   */
  static async handleCallback(code: string) {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      throw new AppError('Google OAuth is not configured', 500);
    }

    // 1) Exchange code for access_token
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: env.GOOGLE_CALLBACK_URL,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error('❌ Google token exchange failed:', err);
      throw new AppError('Failed to authenticate with Google', 502);
    }

    const tokenData = await tokenRes.json() as { access_token: string };

    // 2) Fetch user profile
    const profileRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!profileRes.ok) {
      throw new AppError('Failed to fetch Google profile', 502);
    }

    const profile = await profileRes.json() as {
      sub: string;
      email: string;
      name: string;
      picture?: string;
      email_verified?: boolean;
    };

    if (!profile.email) {
      throw new AppError('Google account does not have an email address', 400);
    }

    console.log(`\n🔑 Google OAuth login: ${profile.email} (${profile.name})\n`);

    // 3) Upsert user in database
    let user = await prisma.user.findUnique({ where: { email: profile.email } });

    if (!user) {
      // Auto-register new Google users
      user = await prisma.user.create({
        data: {
          email: profile.email,
          name: profile.name || profile.email.split('@')[0],
          avatarUrl: profile.picture || null,
          role: 'USER',
          isActive: true,
          isEmailVerified: true, // Google already verified
          googleId: profile.sub,
          referralCode: generateReferralCode(profile.name || 'user'),
        },
      });
      console.log(`✅ New Google user registered: ${user.email}`);
    } else {
      // Update existing user with Google info if missing
      const updates: any = {};
      if (!user.googleId) updates.googleId = profile.sub;
      if (!user.avatarUrl && profile.picture) updates.avatarUrl = profile.picture;
      if (!user.isEmailVerified) updates.isEmailVerified = true;
      updates.lastLoginAt = new Date();

      if (Object.keys(updates).length > 0) {
        user = await prisma.user.update({ where: { id: user.id }, data: updates });
      }
    }

    if (!user.isActive) {
      throw new AppError('Account is deactivated. Contact support.', 403);
    }

    // 4) Generate JWT tokens (reuse existing AuthService method)
    const tokens = AuthService.generateTokens(user);
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: tokens.refreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        avatarUrl: user.avatarUrl,
        role: user.role,
        isSuperAdmin: user.isSuperAdmin,
        membershipLevel: user.kycVerified ? 'Premium Solaris' : 'Basic',
      },
      ...tokens,
    };
  }
}
