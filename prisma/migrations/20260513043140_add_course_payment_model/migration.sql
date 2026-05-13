-- CreateTable
CREATE TABLE "course_payments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "razorpayOrderId" TEXT,
    "razorpayPaymentId" TEXT,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "course_payments_razorpayOrderId_key" ON "course_payments"("razorpayOrderId");

-- CreateIndex
CREATE INDEX "course_payments_userId_idx" ON "course_payments"("userId");

-- CreateIndex
CREATE INDEX "course_payments_courseId_idx" ON "course_payments"("courseId");

-- AddForeignKey
ALTER TABLE "course_payments" ADD CONSTRAINT "course_payments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_payments" ADD CONSTRAINT "course_payments_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
