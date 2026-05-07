// ─────────────────────────────────────────────────────────
// CAFT Financial — Express Server Entry Point
// ─────────────────────────────────────────────────────────

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';

// ── Global Error Handling ────────────────────────────────
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
});

import { env } from './config/env';
import { connectRedis, disconnectRedis } from './config/redis';
import { prisma } from './config/database';
import { errorHandler } from './middleware/errorHandler';
import { apiLimiter } from './middleware/rateLimiter';
import { authenticate } from './middleware/auth';

// Route imports
import authRoutes from './routes/auth.routes';
import userRoutes from './routes/user.routes';
import planRoutes from './routes/plan.routes';
import subscriptionRoutes from './routes/subscription.routes';
import paymentRoutes from './routes/payment.routes';
import adminRoutes from './routes/admin.routes';
import emailRoutes from './routes/email.routes';
import analyticsRoutes from './routes/analytics.routes';
import reviewRoutes from './routes/review.routes';
import uploadRoutes from './routes/upload.routes';
import purchaseRoutes from './routes/purchase.routes';

const app = express();

// ── Global Middleware ────────────────────────────────────

app.use(helmet());
app.use(cors({
  origin: [env.CORS_ORIGIN, 'http://127.0.0.1:3000', 'http://0.0.0.0:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(
  express.json({
    limit: '10mb',
    verify: (req: any, _res, buf) => {
      req.rawBody = buf.toString();
    },
  })
);
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(apiLimiter);

// ── Health Check ─────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({
    success: true,
    message: 'CAFT Financial API is running',
    environment: env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

// ── API Routes ───────────────────────────────────────────

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/plans', planRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/emails', emailRoutes);
app.use('/api/admin/analytics', analyticsRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/purchases', purchaseRoutes);

// ── Public Settings (no auth required) ───────────────────
import { AdminController } from './controllers/admin.controller';
app.get('/api/settings/public', AdminController.getPublicSettings);

// ── Backward-compatible routes for frontend mocks ────────
// These match the existing frontend fetch URLs

app.get('/api/pricing', async (_req, res, next) => {
  try {
    const plans = await prisma.plan.findMany({
      where: { isActive: true },
      include: {
        features: { orderBy: { sortOrder: 'asc' } },
        pricing: { where: { isActive: true }, orderBy: { billingCycle: 'asc' } },
      },
      orderBy: { sortOrder: 'asc' },
    });

    // Transform to match frontend PricingPlan interface
    const formatted = plans.map((p: any) => {
      const monthlyPricing = p.pricing.find((pr: any) => pr.billingCycle === 'MONTHLY');
      return {
        id: p.id,
        slug: p.slug,
        name: p.name,
        price: monthlyPricing ? monthlyPricing.price / 100 : 0,
        description: p.description,
        planType: p.planType,
        itemCategory: p.itemCategory,
        bannerBadge: p.bannerBadge,
        isOneTime: p.isOneTime,
        oneTimePrice: p.oneTimePrice ? p.oneTimePrice / 100 : null,
        freeTrialEnabled: p.freeTrialEnabled,
        freeTrialDays: p.freeTrialDays,
        discountPercent: p.discountPercent,
        discountLabel: p.discountLabel,
        features: p.features.map((f: any) => ({ name: f.name, included: f.included, icon: f.icon })),
        pricing: p.pricing.map((pr: any) => ({ billingCycle: pr.billingCycle, price: pr.price / 100 })),
        isPopular: p.isPopular,
        stockLimit: p.stockLimit,
        stockAvailable: p.stockLimit !== null ? Math.max(0, p.stockLimit - p.stockSold) : null,
      };
    });

    res.json(formatted);
  } catch (error) { next(error); }
});

// NOTE: /api/transactions removed — use authenticated route GET /api/users/me/transactions instead

app.get('/api/stats', authenticate, async (req, res, next) => {
  try {
    const authReq = req as import('./types').AuthenticatedRequest;
    const userId = authReq.user!.userId;
    const totalValue = await prisma.payment.aggregate({
      where: { status: 'CAPTURED', userId },
      _sum: { amount: true },
    });

    res.json({
      totalValue: (totalValue._sum.amount || 0) / 100,
      profitLoss: 12400.00,
      allocation: { domesticEquity: 65, foreignAssets: 25, digitalGold: 10 },
    });
  } catch (error) { next(error); }
});

// ── 404 Handler ──────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
  });
});

// ── Error Handler ────────────────────────────────────────

app.use(errorHandler);

// ── Server Start ─────────────────────────────────────────

async function bootstrap() {
  try {
    // Connect to database
    await prisma.$connect();
    console.log('✅ Database connected');

    // Connect to Redis
    await connectRedis();

    // ── Validate Razorpay Configuration ───────────────────
    console.log('\n🔐 Payment Gateway Configuration:');
    console.log(`   Key ID:         ${env.RAZORPAY_KEY_ID ? env.RAZORPAY_KEY_ID.substring(0, 12) + '...' : '❌ MISSING'}`);
    console.log(`   Key Secret:     ${env.RAZORPAY_KEY_SECRET ? '✅ Set' : '❌ MISSING'}`);
    console.log(`   Webhook Secret: ${env.RAZORPAY_WEBHOOK_SECRET ? '✅ Set' : '⚠️  NOT SET'}`);

    if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
      console.error('\n❌ RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are REQUIRED for payments to work.');
      console.error('   Set them in your .env file or environment variables.\n');
    }

    if (!env.RAZORPAY_WEBHOOK_SECRET) {
      console.warn('\n⚠️  RAZORPAY_WEBHOOK_SECRET is not set!');
      console.warn('   Webhooks will be REJECTED — subscriptions will NOT activate after payment.');
      console.warn('   Set it in Razorpay Dashboard → Settings → Webhooks → Secret');
      console.warn('   Then add RAZORPAY_WEBHOOK_SECRET to your .env / .env.prod file.\n');
    }

    // Start server
    app.listen(env.PORT, () => {
      console.log(`\n🚀 CAFT Financial API Server`);
      console.log(`   Environment: ${env.NODE_ENV}`);
      console.log(`   Port:        ${env.PORT}`);
      console.log(`   Health:      http://localhost:${env.PORT}/api/health`);
      console.log(`   CORS:        ${env.CORS_ORIGIN}\n`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🔄 SIGTERM received, shutting down gracefully...');
  await prisma.$disconnect();
  await disconnectRedis();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🔄 SIGINT received, shutting down gracefully...');
  await prisma.$disconnect();
  await disconnectRedis();
  process.exit(0);
});

bootstrap();

export default app;
