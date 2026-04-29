// ─────────────────────────────────────────────────────────
// CAFT Financial — Admin Role Guard Middleware
// ─────────────────────────────────────────────────────────

import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import { ApiResponse } from '../utils/apiResponse';

/**
 * Requires the user to have ADMIN role (or SUPER_ADMIN).
 * Applied to all admin routes.
 */
export function adminGuard(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    ApiResponse.unauthorized(res, 'Authentication required');
    return;
  }

  if (req.user.role !== 'ADMIN') {
    ApiResponse.forbidden(res, 'Admin access required');
    return;
  }

  next();
}

/**
 * Requires the user to be the Superadmin (seed-created admin).
 * Only this account can create other admins.
 */
export function superAdminGuard(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    ApiResponse.unauthorized(res, 'Authentication required');
    return;
  }

  if (req.user.role !== 'ADMIN' || !req.user.isSuperAdmin) {
    ApiResponse.forbidden(res, 'Superadmin access required. Only the primary administrator can perform this action.');
    return;
  }

  next();
}
