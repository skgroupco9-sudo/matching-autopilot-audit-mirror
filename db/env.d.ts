declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    FILES: R2Bucket;
    WORKER_SHARED_SECRET?: string;
    TELEGRAM_BOT_TOKEN?: string;
    TELEGRAM_WEBHOOK_SECRET?: string;
    TELEGRAM_BOT_USERNAME?: string;
    MATCHPILOT_SETUP_SECRET?: string;
    MATCHPILOT_SESSION_SECRET?: string;
    MATCHPILOT_ADMIN_EMAIL?: string;
    STRIPE_SECRET_KEY?: string;
    STRIPE_WEBHOOK_SECRET?: string;
    STRIPE_PRICE_ID?: string;
    STRIPE_BILLING_ENABLED?: string;
    STRIPE_PLAN_NAME?: string;
    IDENTITY_VAULT_ENCRYPTION_KEY?: string;
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
  }
}
