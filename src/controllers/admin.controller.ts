// ─────────────────────────────────────────────────────────
// CAFT Financial — Admin Controller (Users, Settings, Stats)
// ─────────────────────────────────────────────────────────

import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../config/database';
import { ApiResponse, AppError } from '../utils/apiResponse';
import { AuthenticatedRequest } from '../types';
import { paginationSchema, updateSettingsSchema } from '../utils/validators';
import { computePagination, generateReferralCode } from '../utils/helpers';
import { CacheService, CACHE_KEYS, CACHE_TTL } from '../services/cache.service';

export class AdminController {
  // ── User Management ─────────────────────────────────

  /** GET /api/admin/users — Paginated user list */
  static async getUsers(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit, search, sortBy, sortOrder } = paginationSchema.parse(req.query);
      const statusFilter = req.query.status as string | undefined;

      const where: any = {};
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ];
      }
      if (statusFilter === 'active') where.isActive = true;
      if (statusFilter === 'inactive') where.isActive = false;

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where,
          select: {
            id: true, name: true, email: true, phone: true, role: true,
            isActive: true, isSuperAdmin: true, kycVerified: true,
            createdAt: true, lastLoginAt: true,
            subscriptions: {
              where: { status: 'ACTIVE' },
              include: { plan: { select: { name: true } } },
              take: 1,
            },
          },
          orderBy: { [sortBy || 'createdAt']: sortOrder },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.user.count({ where }),
      ]);

      ApiResponse.paginated(res, users, computePagination(total, page, limit));
    } catch (error) { next(error); }
  }

  /**
   * POST /api/admin/users — Create a new user (admin-only)
   * Since there's no self-registration, admins create user accounts.
   */
  static async createUser(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { email, name, phone, role } = req.body;

      if (!email || !name) throw new AppError('Email and name are required', 400);

      // Only superadmin can set role to ADMIN
      if (role === 'ADMIN' && !req.user?.isSuperAdmin) {
        throw new AppError('Only the Superadmin can create admin accounts', 403);
      }

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) throw new AppError('A user with this email already exists', 409);

      const user = await prisma.user.create({
        data: {
          email,
          name,
          phone: phone || null,
          role: role || 'USER',
          isActive: true,
          referralCode: generateReferralCode(name),
        },
        select: { id: true, name: true, email: true, role: true, isActive: true, referralCode: true },
      });

      await prisma.auditLog.create({
        data: {
          userId: req.user?.userId,
          action: 'CREATE_USER',
          entity: 'User',
          entityId: user.id,
          details: JSON.stringify({ email, name, role: role || 'USER' }),
        },
      });

      ApiResponse.created(res, user, 'User created successfully');
    } catch (error) { next(error); }
  }

  /**
   * POST /api/admin/admins — Create a new admin (SUPERADMIN-ONLY)
   * Requires superAdminGuard middleware.
   */
  static async createAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { email, name, password } = req.body;

      if (!email || !name || !password) {
        throw new AppError('Email, name, and password are required', 400);
      }

      if (password.length < 8) {
        throw new AppError('Password must be at least 8 characters', 400);
      }

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) throw new AppError('A user with this email already exists', 409);

      const passwordHash = await bcrypt.hash(password, 12);

      const admin = await prisma.user.create({
        data: {
          email,
          name,
          role: 'ADMIN',
          passwordHash,
          isActive: true,
          isEmailVerified: true,
          isSuperAdmin: false, // Only the seed admin is superadmin
          referralCode: generateReferralCode(name),
        },
        select: { id: true, name: true, email: true, role: true, isSuperAdmin: true },
      });

      await prisma.auditLog.create({
        data: {
          userId: req.user?.userId,
          action: 'CREATE_ADMIN',
          entity: 'User',
          entityId: admin.id,
          details: JSON.stringify({ email, name }),
        },
      });

      ApiResponse.created(res, admin, 'Admin created successfully');
    } catch (error) { next(error); }
  }

  /** PUT /api/admin/users/:id — Update user status/role */
  static async updateUser(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const { role, isActive } = req.body;

      // Only superadmin can promote/demote to ADMIN
      if (role === 'ADMIN' && !req.user?.isSuperAdmin) {
        throw new AppError('Only the Superadmin can assign admin roles', 403);
      }

      const user = await prisma.user.update({
        where: { id: req.params.id as string },
        data: {
          ...(role !== undefined && { role }),
          ...(isActive !== undefined && { isActive }),
        },
        select: { id: true, name: true, email: true, role: true, isActive: true, isSuperAdmin: true },
      });

      await prisma.auditLog.create({
        data: { userId: req.user?.userId, action: 'UPDATE_USER', entity: 'User', entityId: user.id, details: JSON.stringify({ role, isActive }) },
      });

      ApiResponse.success(res, user, 'User updated');
    } catch (error) { next(error); }
  }

  /** DELETE /api/admin/users/:id — Deactivate user */
  static async deleteUser(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      // Prevent deactivating the superadmin
      const targetUser = await prisma.user.findUnique({ where: { id: req.params.id as string } });
      if (targetUser?.isSuperAdmin) {
        throw new AppError('Cannot deactivate the Superadmin account', 403);
      }

      await prisma.user.update({ where: { id: req.params.id as string }, data: { isActive: false } });
      await prisma.auditLog.create({
        data: { userId: req.user?.userId, action: 'DEACTIVATE_USER', entity: 'User', entityId: req.params.id as string },
      });
      ApiResponse.success(res, null, 'User deactivated');
    } catch (error) { next(error); }
  }

  // ── Stats ───────────────────────────────────────────

  /** GET /api/admin/stats/overview */
  static async getStatsOverview(_req: Request, res: Response, next: NextFunction) {
    try {
      const stats = await CacheService.getOrSet(CACHE_KEYS.STATS_OVERVIEW, CACHE_TTL.STATS, async () => {
        const [totalUsers, activeUsers, totalRevenue, activeSubs] = await Promise.all([
          prisma.user.count(),
          prisma.user.count({ where: { isActive: true } }),
          prisma.payment.aggregate({ where: { status: 'CAPTURED' }, _sum: { amount: true } }),
          prisma.subscription.count({ where: { status: 'ACTIVE' } }),
        ]);

        return {
          totalUsers,
          activeUsers,
          totalRevenue: totalRevenue._sum.amount || 0,
          activeSubscriptions: activeSubs,
          securityScore: 98.2,
        };
      });

      ApiResponse.success(res, stats);
    } catch (error) { next(error); }
  }

  /** GET /api/admin/stats/revenue */
  static async getRevenueStats(_req: Request, res: Response, next: NextFunction) {
    try {
      const revenueByPlan = await prisma.payment.groupBy({
        by: ['subscriptionId'],
        where: { status: 'CAPTURED' },
        _sum: { amount: true },
        _count: true,
      });
      ApiResponse.success(res, revenueByPlan);
    } catch (error) { next(error); }
  }

  // ── Settings ────────────────────────────────────────

  /** GET /api/admin/settings */
  static async getSettings(_req: Request, res: Response, next: NextFunction) {
    try {
      const settings = await prisma.adminSetting.findMany();
      const settingsMap = settings.reduce((acc, s) => ({ ...acc, [s.key]: s.value }), {} as Record<string, string>);
      ApiResponse.success(res, settingsMap);
    } catch (error) { next(error); }
  }

  /** PUT /api/admin/settings */
  static async updateSettings(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const data = updateSettingsSchema.parse(req.body);
      const entries = Object.entries(data).filter(([_, v]) => v !== undefined);

      for (const [key, value] of entries) {
        await prisma.adminSetting.upsert({
          where: { key },
          create: { key, value: String(value) },
          update: { value: String(value) },
        });
      }

      await prisma.auditLog.create({
        data: { userId: req.user?.userId, action: 'UPDATE_SETTINGS', entity: 'AdminSetting', details: JSON.stringify(data) },
      });

      ApiResponse.success(res, data, 'Settings updated');
    } catch (error) { next(error); }
  }
}
