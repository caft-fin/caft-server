// ─────────────────────────────────────────────────────────
// CAFT Financial — Category Pricing Service
//
// Manages category-level pricing rules (GST, gateway charges,
// service fee, processing fee, platform charges).
// Admin sets these once per category, all products auto-inherit.
// ─────────────────────────────────────────────────────────

import { prisma } from '../config/database';
import { AppError } from '../utils/apiResponse';
import { CategoryPricingInput } from '../types';

export class CategoryPricingService {
  /**
   * Get all category pricing rules
   */
  static async getAll() {
    return prisma.categoryPricing.findMany({
      orderBy: { itemCategory: 'asc' },
    });
  }

  /**
   * Get pricing for a specific category
   */
  static async getByCategory(itemCategory: string) {
    return prisma.categoryPricing.findUnique({
      where: { itemCategory: itemCategory as any },
    });
  }

  /**
   * Upsert category pricing — create if not exists, update if exists.
   * This is the admin's "set once" operation.
   */
  static async upsert(input: CategoryPricingInput) {
    const data: any = {};

    if (input.gstMode !== undefined) data.gstMode = input.gstMode;
    if (input.gstValue !== undefined) data.gstValue = input.gstValue;
    if (input.gatewayChargeMode !== undefined) data.gatewayChargeMode = input.gatewayChargeMode;
    if (input.gatewayChargeValue !== undefined) data.gatewayChargeValue = input.gatewayChargeValue;
    if (input.serviceFeeMode !== undefined) data.serviceFeeMode = input.serviceFeeMode;
    if (input.serviceFeeValue !== undefined) data.serviceFeeValue = input.serviceFeeValue;
    if (input.processingFeeMode !== undefined) data.processingFeeMode = input.processingFeeMode;
    if (input.processingFeeValue !== undefined) data.processingFeeValue = input.processingFeeValue;
    if (input.platformChargeMode !== undefined) data.platformChargeMode = input.platformChargeMode;
    if (input.platformChargeValue !== undefined) data.platformChargeValue = input.platformChargeValue;

    return prisma.categoryPricing.upsert({
      where: { itemCategory: input.itemCategory as any },
      create: {
        itemCategory: input.itemCategory as any,
        ...data,
      },
      update: data,
    });
  }

  /**
   * Delete category pricing (reset to defaults)
   */
  static async delete(itemCategory: string) {
    const existing = await prisma.categoryPricing.findUnique({
      where: { itemCategory: itemCategory as any },
    });
    if (!existing) throw new AppError('Category pricing not found', 404);

    await prisma.categoryPricing.delete({
      where: { itemCategory: itemCategory as any },
    });

    return { message: 'Category pricing reset to defaults' };
  }
}
