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
import { CategoryPricingService } from '../services/categoryPricing.service';

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

  /** GET /api/admin/users/:id/details — Full user detail for admin panel */
  static async getUserDetails(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params as { id: string };

      const user = await prisma.user.findUnique({
        where: { id },
        include: {
          subscriptions: {
            include: { plan: { select: { name: true, slug: true } } },
            orderBy: { createdAt: 'desc' },
          },
          payments: {
            orderBy: { createdAt: 'desc' },
            select: {
              id: true, amount: true, currency: true, status: true, method: true,
              description: true, failureReason: true, razorpayPaymentId: true,
              createdAt: true,
              subscription: { select: { plan: { select: { name: true } } } },
            },
          },
          linkedAccounts: true,
          _count: { select: { referrals: true, reviews: true, transactions: true } },
        },
      });

      if (!user) throw new AppError('User not found', 404);

      // Calculate total revenue from this user
      const totalRevenue = user.payments
        .filter((p: any) => p.status === 'CAPTURED' || p.status === 'AUTHORIZED')
        .reduce((sum: number, p: any) => sum + p.amount, 0);

      // Find active subscription
      const activeSubscription = user.subscriptions.find((s: any) => s.status === 'ACTIVE');

      // Strip sensitive fields
      const { passwordHash, ...safeUser } = user;

      ApiResponse.success(res, {
        ...safeUser,
        totalRevenue,
        totalRevenueFormatted: `₹${(totalRevenue / 100).toLocaleString('en-IN')}`,
        activeSubscription: activeSubscription || null,
        verifiedBy: user.googleId ? 'Google' : user.isEmailVerified ? 'OTP' : 'Not verified',
      });
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

  /** GET /api/settings/public — Public-safe settings (no auth) */
  static readonly PUBLIC_KEY_PREFIXES = ['page_'];
  static readonly PUBLIC_KEYS = [
    'heroMediaType', 'heroImageUrl', 'heroVideoUrl',
    'logoType', 'logoSvgUrl',
    'bannerCompanies', 'bannerColorMode', 'bannerDefaultColor',
    'bannerTextSize', 'bannerFontFamily',
    'appName',
  ];

  static async getPublicSettings(_req: Request, res: Response, next: NextFunction) {
    try {
      const settings = await prisma.adminSetting.findMany();
      const filtered = settings.filter(s =>
        AdminController.PUBLIC_KEYS.includes(s.key) ||
        AdminController.PUBLIC_KEY_PREFIXES.some(p => s.key.startsWith(p))
      );
      const settingsMap = filtered.reduce((acc, s) => ({ ...acc, [s.key]: s.value }), {} as Record<string, string>);
      ApiResponse.success(res, settingsMap);
    } catch (error) { next(error); }
  }

  /** PUT /api/admin/settings */
  static async updateSettings(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      // Extract page_* keys before schema validation (they're dynamic)
      const pageEntries = Object.entries(req.body)
        .filter(([k]) => k.startsWith('page_'))
        .map(([k, v]) => [k, String(v)] as [string, string]);

      const data = updateSettingsSchema.parse(req.body);
      const entries = Object.entries(data).filter(([_, v]) => v !== undefined);

      for (const [key, value] of [...entries, ...pageEntries]) {
        await prisma.adminSetting.upsert({
          where: { key },
          create: { key, value: String(value) },
          update: { value: String(value) },
        });
      }

      // Invalidate test account cache if any test account settings were changed
      const testAccountKeys = ['testAccountEnabled', 'testAccountEmail', 'testAccountOtp'];
      const hasTestAccountChanges = entries.some(([key]) => testAccountKeys.includes(key));
      if (hasTestAccountChanges) {
        await CacheService.del('settings:test_account');
      }

      await prisma.auditLog.create({
        data: { userId: req.user?.userId, action: 'UPDATE_SETTINGS', entity: 'AdminSetting', details: JSON.stringify({ ...data, ...Object.fromEntries(pageEntries) }) },
      });

      ApiResponse.success(res, data, 'Settings updated');
    } catch (error) { next(error); }
  }

  // ── Danger Zone (SUPERADMIN ONLY) ──────────────────────

  /** Whitelist of Prisma model names → DB table names */
  private static readonly TABLE_MAP: Record<string, string> = {
    User: 'users',
    OtpToken: 'otp_tokens',
    RefreshToken: 'refresh_tokens',
    Plan: 'plans',
    PlanFeature: 'plan_features',
    PlanPricing: 'plan_pricing',
    PlanBundle: 'plan_bundles',
    BundlePlan: 'bundle_plans',
    Subscription: 'subscriptions',
    Payment: 'payments',
    Transaction: 'transactions',
    LinkedAccount: 'linked_accounts',
    EmailCampaign: 'email_campaigns',
    EmailRecipient: 'email_recipients',
    EmailTemplate: 'email_templates',
    NotificationPreference: 'notification_preferences',
    AdminSetting: 'admin_settings',
    AuditLog: 'audit_logs',
  };

  /** Models that have a createdAt column for ordering */
  private static readonly HAS_CREATED_AT = new Set([
    'User', 'OtpToken', 'RefreshToken', 'Plan', 'PlanPricing', 'PlanBundle',
    'Subscription', 'Payment', 'Transaction', 'LinkedAccount',
    'EmailCampaign', 'EmailTemplate', 'NotificationPreference',
    'AdminSetting', 'AuditLog',
  ]);

  /** Helper to get a Prisma delegate by model name */
  private static getDelegate(modelName: string): any {
    const map: Record<string, any> = {
      User: prisma.user,
      OtpToken: prisma.otpToken,
      RefreshToken: prisma.refreshToken,
      Plan: prisma.plan,
      PlanFeature: prisma.planFeature,
      PlanPricing: prisma.planPricing,
      PlanBundle: prisma.planBundle,
      BundlePlan: prisma.bundlePlan,
      Subscription: prisma.subscription,
      Payment: prisma.payment,
      Transaction: prisma.transaction,
      LinkedAccount: prisma.linkedAccount,
      EmailCampaign: prisma.emailCampaign,
      EmailRecipient: prisma.emailRecipient,
      EmailTemplate: prisma.emailTemplate,
      NotificationPreference: prisma.notificationPreference,
      AdminSetting: prisma.adminSetting,
      AuditLog: prisma.auditLog,
    };
    return map[modelName] ?? null;
  }

  /** GET /api/admin/danger/tables — List all database tables */
  static async listTables(_req: Request, res: Response, next: NextFunction) {
    try {
      const tables = Object.entries(AdminController.TABLE_MAP).map(([name, dbTable]) => ({
        name,
        dbTable,
      }));
      ApiResponse.success(res, tables);
    } catch (error) { next(error); }
  }

  /** GET /api/admin/danger/tables/:table — Get all records from a table */
  static async getTableRecords(req: Request, res: Response, next: NextFunction) {
    try {
      const modelName: string = String(req.params.table);
      if (!AdminController.TABLE_MAP[modelName]) {
        throw new AppError(`Unknown table: ${modelName}`, 400);
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
      const delegate = AdminController.getDelegate(modelName);

      // Only order by createdAt for models that have it
      const findOptions: any = {
        skip: (page - 1) * limit,
        take: limit,
      };
      if (AdminController.HAS_CREATED_AT.has(modelName)) {
        findOptions.orderBy = { createdAt: 'desc' };
      }

      const [records, total] = await Promise.all([
        delegate.findMany(findOptions),
        delegate.count(),
      ]);

      // Serialize BigInt/Decimal values to strings for JSON
      const serialized = JSON.parse(JSON.stringify(records, (_key: string, v: any) =>
        typeof v === 'bigint' ? v.toString() : v
      ));

      const totalPages = Math.ceil(total / limit);
      ApiResponse.paginated(res, serialized, {
        total,
        page,
        limit,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      });
    } catch (error) { next(error); }
  }

  /** DELETE /api/admin/danger/tables/:table/:id — Hard-delete a record */
  static async deleteRecord(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
      const modelName: string = String(req.params.table);
      const recordId: string = String(req.params.id);
      if (!AdminController.TABLE_MAP[modelName]) {
        throw new AppError(`Unknown table: ${modelName}`, 400);
      }

      const delegate = AdminController.getDelegate(modelName);

      // Prevent deletion of the superadmin user
      if (modelName === 'User') {
        const target = await prisma.user.findUnique({ where: { id: recordId } });
        if (target?.isSuperAdmin) {
          throw new AppError('Cannot delete the Superadmin account', 403);
        }
      }

      await delegate.delete({ where: { id: recordId } });

      await prisma.auditLog.create({
        data: {
          userId: req.user?.userId,
          action: 'DANGER_DELETE_RECORD',
          entity: modelName,
          entityId: recordId,
          details: JSON.stringify({ table: AdminController.TABLE_MAP[modelName] }),
        },
      });

      ApiResponse.success(res, null, `Record deleted from ${AdminController.TABLE_MAP[modelName]}`);
    } catch (error) { next(error); }
  }

  // ── Category Pricing ─────────────────────────────────

  /**
   * GET /admin/category-pricing
   * Returns all category pricing rules
   */
  static async getCategoryPricing(req: Request, res: Response, next: NextFunction) {
    try {
      const pricing = await CategoryPricingService.getAll();
      ApiResponse.success(res, pricing);
    } catch (error) { next(error); }
  }

  /**
   * PUT /admin/category-pricing
   * Upsert pricing for a specific item category
   */
  static async upsertCategoryPricing(req: Request, res: Response, next: NextFunction) {
    try {
      const input = req.body;
      if (!input.itemCategory) {
        return ApiResponse.error(res, 'itemCategory is required', 400);
      }
      const result = await CategoryPricingService.upsert(input);
      ApiResponse.success(res, result, 'Category pricing updated');
    } catch (error) { next(error); }
  }

  // ── Plan Subscriber Details ──────────────────────────

  /**
   * GET /admin/plans/:planId/subscribers
   * Returns detailed subscriber list for a specific plan
   * Includes: name, email, phone, location, amount paid, payment history
   */
  static async getPlanSubscribers(req: Request, res: Response, next: NextFunction) {
    try {
      const planId = req.params.planId as string;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;

      // Verify plan exists
      const plan = await prisma.plan.findUnique({ where: { id: planId } });
      if (!plan) return ApiResponse.error(res, 'Plan not found', 404);

      // Get subscribers with full details
      const [subscriptions, total] = await Promise.all([
        prisma.subscription.findMany({
          where: { planId: planId, status: { in: ['ACTIVE', 'AUTHENTICATED'] } },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                lastCity: true,
                lastState: true,
                lastCountry: true,
                lastPincode: true,
                createdAt: true,
                lastLoginAt: true,
              },
            },
            payments: {
              select: {
                id: true,
                amount: true,
                currency: true,
                status: true,
                method: true,
                razorpayPaymentId: true,
                createdAt: true,
              },
              orderBy: { createdAt: 'desc' as const },
              take: 10,
            },
          },
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { createdAt: 'desc' },
        }),
        prisma.subscription.count({
          where: { planId: planId, status: { in: ['ACTIVE', 'AUTHENTICATED'] } },
        }),
      ]);

      // Map to detailed subscriber view
      const subscribers = subscriptions.map((sub: any) => {
        const totalPaid = (sub.payments || [])
          .filter((p: any) => p.status === 'CAPTURED')
          .reduce((sum: number, p: any) => sum + p.amount, 0);

        return {
          subscriptionId: sub.id,
          status: sub.status,
          billingCycle: sub.billingCycle,
          subscribedAt: sub.createdAt,
          currentPeriodEnd: sub.currentPeriodEnd,
          user: sub.user,
          location: [
            sub.user?.lastCity,
            sub.user?.lastState,
            sub.user?.lastCountry,
          ].filter(Boolean).join(', ') || 'Unknown',
          totalPaid,
          totalPaidFormatted: `₹${(totalPaid / 100).toLocaleString()}`,
          paymentHistory: sub.payments || [],
        };
      });

      ApiResponse.success(res, {
        plan: { id: plan.id, name: plan.name, slug: plan.slug, itemCategory: plan.itemCategory },
        subscribers,
        meta: computePagination(total, page, limit),
      });
    } catch (error) { next(error); }
  }
}
