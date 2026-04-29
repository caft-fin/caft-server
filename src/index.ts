// ─────────────────────────────────────────────────────────
// CAFT Financial — Express Server Entry Point
// ─────────────────────────────────────────────────────────

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';

import { env } from './config/env';
import { connectRedis, disconnectRedis } from './config/redis';
import { prisma } from './config/database';
import { errorHandler } from './middleware/errorHandler';
import { apiLimiter } from './middleware/rateLimiter';

// Route imports
import authRoutes from './routes/auth.routes';
import userRoutes from './routes/user.routes';
import planRoutes from './routes/plan.routes';
import subscriptionRoutes from './routes/subscription.routes';
import paymentRoutes from './routes/payment.routes';
import adminRoutes from './routes/admin.routes';
import emailRoutes from './routes/email.routes';

const app = express();

// ── Global Middleware ────────────────────────────────────

app.use(helmet());
app.use(cors({
  origin: env.CORS_ORIGIN,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '10mb' }));
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

// ── Backward-compatible routes for frontend mocks ────────
// These match the existing frontend fetch URLs

app.get('/api/pricing', async (_req, res, next) => {
  try {
    const plans = await prisma.plan.findMany({
      where: { isActive: true },
      include: { features: true },
      orderBy: { sortOrder: 'asc' },
    });

    // Transform to match frontend PricingPlan interface
    const formatted = plans.map((p) => ({
      id: p.slug,
      name: p.name,
      price: p.priceMonthly / 100, // Convert paise to rupees
      description: p.description,
      features: p.features.map((f) => ({ name: f.name, included: f.included })),
      isPopular: p.isPopular,
    }));

    res.json(formatted);
  } catch (error) { next(error); }
});

app.get('/api/transactions', async (req, res, next) => {
  try {
    const transactions = await prisma.transaction.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
    });
    res.json(transactions);
  } catch (error) { next(error); }
});

app.get('/api/stats', async (_req, res, next) => {
  try {
    const totalValue = await prisma.payment.aggregate({
      where: { status: 'CAPTURED' },
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
