export default () => ({
  port: parseInt(process.env.PORT ?? '3001', 10),
  databaseUrl: process.env.DATABASE_URL,
  stripeSecretKey: process.env.STRIPE_SECRET_KEY,
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  appOrigin: process.env.APP_ORIGIN ?? 'http://localhost:5173',
  stripeSuccessPath: process.env.STRIPE_SUCCESS_PATH ?? '/mypage?purchase=success',
  stripeCancelPath: process.env.STRIPE_CANCEL_PATH ?? '/mypage?purchase=cancel',
});