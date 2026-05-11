// ─────────────────────────────────────────────────────────
// CAFT Financial — Environment Configuration
// ─────────────────────────────────────────────────────────

import { z } from 'zod';

const envSchema = z.object({
  PORT: z.string().default('5000').transform(Number),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),

  DATABASE_URL: z.string(),

  REDIS_URL: z.string().default('redis://localhost:6379'),

  JWT_ACCESS_SECRET: z.string(),
  JWT_REFRESH_SECRET: z.string(),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),

  RAZORPAY_KEY_ID: z.string(),
  RAZORPAY_KEY_SECRET: z.string(),
  RAZORPAY_WEBHOOK_SECRET: z.string().default(''),

  AWS_REGION: z.string().default('ap-south-1'),
  AWS_ACCESS_KEY_ID: z.string(),
  AWS_SECRET_ACCESS_KEY: z.string(),
  SES_ACCESS_KEY_ID: z.string().optional(),
  SES_SECRET_ACCESS_KEY: z.string().optional(),
  SES_FROM_EMAIL: z.string().default('noreply@caft.financial'),
  SES_FROM_NAME: z.string().default('CAFT Financial'),

  // S3 Course Media
  S3_COURSE_BUCKET: z.string().default('caft-financial-assets-dev-12345'),
  CLOUDFRONT_DOMAIN: z.string().default(''),
  CLOUDFRONT_KEY_PAIR_ID: z.string().default(''),
  CLOUDFRONT_PRIVATE_KEY: z.string().default(''),

  APP_NAME: z.string().default('CAFT Financial'),
  APP_URL: z.string().default('http://localhost:3000'),

  // Test account defaults (overridable via AdminSettings)
  TEST_ACCOUNT_ENABLED: z.string().default('true'),
  TEST_ACCOUNT_EMAIL: z.string().default('cafttest@gmail.com'),
  TEST_ACCOUNT_OTP: z.string().default('852085'),

  // Google OAuth (optional — login button shows but won't work without these)
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALLBACK_URL: z.string().default('http://localhost:5000/api/auth/google/callback'),
});

function loadEnv() {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error('❌ Invalid environment variables:');
    console.error(parsed.error.flatten().fieldErrors);
    process.exit(1);
  }

  return parsed.data;
}

export const env = loadEnv();
export type Env = z.infer<typeof envSchema>;
