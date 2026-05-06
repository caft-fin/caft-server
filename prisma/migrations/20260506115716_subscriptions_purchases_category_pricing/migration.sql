-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('CREATED', 'PAID', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PricingMode" AS ENUM ('PERCENT', 'FLAT');

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "purchaseId" TEXT;

-- AlterTable
ALTER TABLE "plans" ADD COLUMN     "gatewayChargeMode" "PricingMode",
ADD COLUMN     "gatewayChargeValue" DOUBLE PRECISION,
ADD COLUMN     "gstMode" "PricingMode",
ADD COLUMN     "gstValue" DOUBLE PRECISION,
ADD COLUMN     "platformChargeMode" "PricingMode",
ADD COLUMN     "platformChargeValue" DOUBLE PRECISION,
ADD COLUMN     "processingFeeMode" "PricingMode",
ADD COLUMN     "processingFeeValue" DOUBLE PRECISION,
ADD COLUMN     "serviceFeeMode" "PricingMode",
ADD COLUMN     "serviceFeeValue" DOUBLE PRECISION,
ADD COLUMN     "stockSold" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "purchases" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "razorpayOrderId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" INTEGER NOT NULL,
    "totalAmount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "PurchaseStatus" NOT NULL DEFAULT 'CREATED',
    "itemPrice" INTEGER NOT NULL DEFAULT 0,
    "gstAmount" INTEGER NOT NULL DEFAULT 0,
    "gatewayCharge" INTEGER NOT NULL DEFAULT 0,
    "serviceFee" INTEGER NOT NULL DEFAULT 0,
    "processingFee" INTEGER NOT NULL DEFAULT 0,
    "platformCharge" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_pricing" (
    "id" TEXT NOT NULL,
    "itemCategory" "ItemCategory" NOT NULL,
    "gstMode" "PricingMode" NOT NULL DEFAULT 'PERCENT',
    "gstValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "gatewayChargeMode" "PricingMode" NOT NULL DEFAULT 'PERCENT',
    "gatewayChargeValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "serviceFeeMode" "PricingMode" NOT NULL DEFAULT 'PERCENT',
    "serviceFeeValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "processingFeeMode" "PricingMode" NOT NULL DEFAULT 'PERCENT',
    "processingFeeValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "platformChargeMode" "PricingMode" NOT NULL DEFAULT 'PERCENT',
    "platformChargeValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "category_pricing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchases_razorpayOrderId_key" ON "purchases"("razorpayOrderId");

-- CreateIndex
CREATE INDEX "purchases_userId_idx" ON "purchases"("userId");

-- CreateIndex
CREATE INDEX "purchases_planId_idx" ON "purchases"("planId");

-- CreateIndex
CREATE INDEX "purchases_status_idx" ON "purchases"("status");

-- CreateIndex
CREATE INDEX "purchases_razorpayOrderId_idx" ON "purchases"("razorpayOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "category_pricing_itemCategory_key" ON "category_pricing"("itemCategory");

-- CreateIndex
CREATE INDEX "payments_purchaseId_idx" ON "payments"("purchaseId");

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "purchases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
