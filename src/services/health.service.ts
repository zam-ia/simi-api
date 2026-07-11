import { getConfig, hasSupabaseConfig, hasWhatsAppConfig } from "../config.js";
import { getSupabaseAdmin } from "../lib/supabase.js";
import { getOutboxHealth } from "./outbox.service.js";

export async function getHealth() {
  const startedAt = Date.now();
  const config = getConfig();
  const response = {
    ok: true,
    service: "simi-api",
    timestamp: new Date().toISOString(),
    checks: {
      supabase: { configured: hasSupabaseConfig(config), ok: false, latencyMs: 0 },
      whatsapp: { configured: hasWhatsAppConfig(config), webhookConfigured: Boolean(config.metaAppSecret && config.metaWebhookVerifyToken) },
      outbox: { pending: 0, retry: 0, dead: 0, oldestAgeSeconds: 0 }
    },
    durationMs: 0
  };

  if (hasSupabaseConfig(config)) {
    const databaseStartedAt = Date.now();
    try {
      const supabase = getSupabaseAdmin();
      const { error } = await supabase.from("clients").select("id", { head: true, count: "estimated" }).limit(1);
      response.checks.supabase.ok = !error;
      response.checks.supabase.latencyMs = Date.now() - databaseStartedAt;
      if (!error) {
        try {
          const outbox = await getOutboxHealth();
          response.checks.outbox = {
            pending: outbox.pending,
            retry: outbox.retry,
            dead: outbox.dead,
            oldestAgeSeconds: outbox.oldestAgeSeconds
          };
        } catch {
          // Migration 020 may not be applied yet; the main health check can stay available.
        }
      }
    } catch {
      response.checks.supabase.ok = false;
      response.checks.supabase.latencyMs = Date.now() - databaseStartedAt;
    }
  }

  response.durationMs = Date.now() - startedAt;
  response.ok = response.checks.supabase.ok && response.checks.outbox.oldestAgeSeconds < 300 && response.checks.outbox.dead < 10;
  return response;
}
