// ─────────────────────────────────────────────────────────
// CAFT Financial — JWT Authentication Middleware
// ─────────────────────────────────────────────────────────

import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { AuthenticatedRequest, JwtPayload } from '../types';
import { ApiResponse } from '../utils/apiResponse';

export function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      ApiResponse.unauthorized(res, 'Access token is required');
      return;
    }

    const token = authHeader.split(' ')[1];

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
