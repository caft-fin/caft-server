// ─────────────────────────────────────────────────────────
// CAFT Financial — Razorpay Client Configuration
// ─────────────────────────────────────────────────────────

import Razorpay from 'razorpay';
import { env } from './env';

let razorpayClient: InstanceType<typeof Razorpay>;

export function getRazorpayClient(): InstanceType<typeof Razorpay> {
  if (!razorpayClient) {
    razorpayClient = new Razorpay({
      key_id: env.RAZORPAY_KEY_ID,
      key_secret: env.RAZORPAY_KEY_SECRET,
    });
    console.log('✅ Razorpay client initialized');
  }

  return razorpayClient;
}
