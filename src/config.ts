export type RuntimeConfig = {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  simiWebOrigin: string;
  workerToken: string;
  workerId: string;
  workerConcurrency: number;
  metaGraphVersion: string;
  metaAccessToken: string;
  metaPhoneNumberId: string;
  metaBusinessAccountId: string;
  metaAppSecret: string;
  metaWebhookVerifyToken: string;
};

export function getConfig(): RuntimeConfig {
  return {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "",
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    simiWebOrigin: process.env.SIMI_WEB_ORIGIN || "*",
    workerToken: process.env.WORKER_TOKEN || process.env.CRON_SECRET || "",
    workerId: process.env.WORKER_ID || `simi-worker-${process.env.VERCEL_REGION || "local"}`,
    workerConcurrency: clamp(Number(process.env.WORKER_CONCURRENCY || 5), 1, 20),
    metaGraphVersion: process.env.META_GRAPH_VERSION || "",
    metaAccessToken: process.env.META_WHATSAPP_ACCESS_TOKEN || "",
    metaPhoneNumberId: process.env.META_WHATSAPP_PHONE_NUMBER_ID || "",
    metaBusinessAccountId: process.env.META_WHATSAPP_BUSINESS_ACCOUNT_ID || "",
    metaAppSecret: process.env.META_APP_SECRET || "",
    metaWebhookVerifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN || ""
  };
}

export function hasSupabaseConfig(config = getConfig()) {
  return Boolean(config.supabaseUrl && config.supabaseServiceRoleKey);
}

export function hasWhatsAppConfig(config = getConfig()) {
  return Boolean(config.metaGraphVersion && config.metaAccessToken && config.metaPhoneNumberId);
}

function clamp(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}
