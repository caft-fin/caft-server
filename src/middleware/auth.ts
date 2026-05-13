// ─────────────────────────────────────────────────────────
// CAFT Financial — JWT Authentication Middleware
// ─────────────────────────────────────────────────────────

import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { AuthenticatedRequest, JwtPayload } from '../types';
import { ApiResponse } from '../utils/apiResponse';

/**
 * Optional authenticate — sets req.user if a valid token is present,
 * but does NOT block the request if the token is absent or invalid.
 * Use on routes that return different data for guests vs logged-in users.
 */
export function optionalAuthenticate(req: AuthenticatedRequest, _res: Response, next: NextFunction): void {
  try {
    const cookies = req.cookies as Record<string, string | undefined>;
    const authHeader = req.headers.authorization;

    const token =
      cookies?.caft_access ??
      (authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : undefined);

    if (!token) {
      // No token — continue as guest (req.user stays undefined)
      return next();
    }

    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;
    req.user = decoded;
    next();
  } catch {
    // Token present but invalid / expired — continue as guest
    next();
  }
}

export function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  try {
    // Prefer httpOnly cookie (set by our auth endpoints on login/refresh).
    // Fall back to Authorization: Bearer header for API clients that cannot use cookies
    // (e.g., mobile apps, CLI tools, third-party integrations).
    const cookies = req.cookies as Record<string, string | undefined>;
    const authHeader = req.headers.authorization;

    const token =
      cookies?.caft_access ??
      (authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : undefined);

    if (!token) {
      ApiResponse.unauthorized(res, 'Access token is required');
      return;
    }

    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;
    req.user = decoded;
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      ApiResponse.unauthorized(res, 'Access token has expired');
      return;
    }
    if (error instanceof jwt.JsonWebTokenError) {
      ApiResponse.unauthorized(res, 'Invalid access token');
      return;
    }
    ApiResponse.serverError(res, 'Authentication failed');
  }
}
