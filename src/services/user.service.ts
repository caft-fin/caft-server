// ─────────────────────────────────────────────────────────
// CAFT Financial — User Service
// ─────────────────────────────────────────────────────────

import { prisma } from '../config/database';
import { AppError } from '../utils/apiResponse';
import { CacheService, CACHE_KEYS, CACHE_TTL } from './cache.service';

export class UserService {
  static async getProfile(userId: string) {
    return CacheService.getOrSet(CACHE_KEYS.USER_PROFILE(userId), CACHE_TTL.USER_PROFILE, async () => {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true, email: true, name: true, phone: true, avatarUrl: true,
          role: true, isActive: true, isEmailVerified: true, kycVerified: true,
          twoFactorEnabled: true, biometricEnabled: true, referralCode: true,
          createdAt: true, lastLoginAt: true,
          _count: { select: { referrals: true } },
        },
      });
      if (!user) throw new AppError('User not found', 404);
      return user;
    });
  }

  static async updateProfile(userId: string, data: { name?: string; phone?: string; avatarUrl?: string }) {
    const user = await prisma.user.update({
      where: { id: userId },
      data,
      select: { id: true, email: true, name: true, phone: true, avatarUrl: true, role: true },
    });
    await CacheService.del(CACHE_KEYS.USER_PROFILE(userId));
    return user;
  }

  static async getLinkedAccounts(userId: string) {
    return prisma.linkedAccount.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  }

  static async addLinkedAccount(userId: string, data: {
    bankName: string; bankAbbr: string; accountName: string;
    last4: string; accountType?: string; colorClass?: string;
  }) {
    return prisma.linkedAccount.create({ data: { userId, ...data } });
  }

  static async removeLinkedAccount(userId: string, accountId: string) {
    const account = await prisma.linkedAccount.findFirst({ where: { id: accountId, userId } });
    if (!account) throw new AppError('Linked account not found', 404);
    await prisma.linkedAccount.delete({ where: { id: accountId } });
    return { message: 'Account removed' };
  }

  static async getNotificationPreferences(userId: string) {
    let prefs = await prisma.notificationPreference.findUnique({ where: { userId } });
    if (!prefs) {
      prefs = await prisma.notificationPreference.create({ data: { userId } });
    }
    return prefs;
  }

  static async updateNotificationPreferences(userId: string, data: Record<string, boolean>) {
    return prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
  }

  static async updateSecurity(userId: string, data: { twoFactorEnabled?: boolean; biometricEnabled?: boolean }) {
    const user = await prisma.user.update({ where: { id: userId }, data });
    await CacheService.del(CACHE_KEYS.USER_PROFILE(userId));
    return { twoFactorEnabled: user.twoFactorEnabled, biometricEnabled: user.biometricEnabled };
  }

  static async deactivateAccount(userId: string) {
    await prisma.user.update({ where: { id: userId }, data: { isActive: false } });
    await CacheService.del(CACHE_KEYS.USER_PROFILE(userId));
    return { message: 'Account deactivated' };
  }

  static async getTransactions(userId: string, page: number, limit: number) {
    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where: { userId }, orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit, take: limit,
      }),
      prisma.transaction.count({ where: { userId } }),
    ]);
    return { transactions, total };
  }
}
