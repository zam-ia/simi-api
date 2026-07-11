import { getConfig, hasWhatsAppConfig } from "../config.js";
import { ApiError } from "../lib/api-error.js";
import { getSupabaseAdmin } from "../lib/supabase.js";
import { sendWhatsAppTemplate, WhatsAppProviderError } from "../modules/whatsapp/whatsapp.client.js";
import type { NotificationOutboxJob } from "../modules/whatsapp/whatsapp.types.js";

const retryScheduleSeconds = [30, 120, 600, 1800, 7200, 21600];

export type WorkerBatchResult = {
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  dead: number;
  durationMs: number;
};

export async function processOutboxBatch(limit = 20): Promise<WorkerBatchResult> {
  const startedAt = Date.now();
  const config = getConfig();
  if (!hasWhatsAppConfig(config)) throw new ApiError("WhatsApp Cloud API no está configurada.", 503, "WHATSAPP_NOT_CONFIGURED");

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("claim_notification_outbox", {
    p_worker_id: config.workerId,
    p_limit: Math.min(Math.max(limit, 1), 100),
    p_lock_timeout_seconds: 300
  });

  if (error) {
    const migrationMissing = error.code === "PGRST202" || error.message.includes("claim_notification_outbox");
    throw new ApiError(
      migrationMissing ? "Aplica la migración 020_whatsapp_outbox_and_tenant_security.sql." : "No se pudo reclamar la cola de notificaciones.",
      500,
      migrationMissing ? "OUTBOX_MIGRATION_MISSING" : "OUTBOX_CLAIM_FAILED"
    );
  }

  const jobs = (data || []) as NotificationOutboxJob[];
  const counters = { sent: 0, retried: 0, failed: 0, dead: 0 };

  await runWithConcurrency(jobs, config.workerConcurrency, async (job) => {
    const outcome = await processJob(job, config.workerId);
    counters[outcome] += 1;
  });

  const result: WorkerBatchResult = {
    claimed: jobs.length,
    ...counters,
    durationMs: Date.now() - startedAt
  };

  await recordWorkerHeartbeat(result);
  console.log(JSON.stringify({ level: "info", event: "whatsapp.worker_batch", worker_id: config.workerId, ...result }));
  return result;
}

export async function getOutboxHealth() {
  const supabase = getSupabaseAdmin();
  const [{ count: pending }, { count: retry }, { count: dead }, oldest] = await Promise.all([
    supabase.from("notification_outbox").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("notification_outbox").select("id", { count: "exact", head: true }).eq("status", "retry"),
    supabase.from("notification_outbox").select("id", { count: "exact", head: true }).eq("status", "dead"),
    supabase.from("notification_outbox").select("created_at").in("status", ["pending", "retry"]).order("created_at", { ascending: true }).limit(1).maybeSingle()
  ]);

  const oldestCreatedAt = oldest.data?.created_at || null;
  return {
    pending: pending || 0,
    retry: retry || 0,
    dead: dead || 0,
    oldestCreatedAt,
    oldestAgeSeconds: oldestCreatedAt ? Math.max(0, Math.floor((Date.now() - new Date(oldestCreatedAt).getTime()) / 1000)) : 0
  };
}

async function processJob(job: NotificationOutboxJob, workerId: string): Promise<"sent" | "retried" | "failed" | "dead"> {
  const supabase = getSupabaseAdmin();

  try {
    const result = await sendWhatsAppTemplate(job);
    const now = new Date().toISOString();
    const { error } = await supabase
      .from("notification_outbox")
      .update({
        status: "sent",
        provider_message_id: result.messageId,
        provider_response: result.response,
        last_error: null,
        sent_at: now,
        locked_at: null,
        locked_by: null
      })
      .eq("id", job.id)
      .eq("locked_by", workerId);

    if (error) throw new Error(`Meta aceptó el mensaje, pero no se guardó el estado: ${error.message}`);

    if (job.order_id) {
      await Promise.all([
        supabase.from("orders").update({ whatsapp_sent: true }).eq("id", job.order_id),
        recordWhatsAppActivity(job, "whatsapp.sent", "sent", { provider_message_id: result.messageId })
      ]);
    }
    return "sent";
  } catch (error) {
    const providerError = error instanceof WhatsAppProviderError ? error : null;
    const retryable = providerError?.retryable ?? true;
    const attempt = Math.max(1, Number(job.attempts || 1));
    const canRetry = retryable && attempt < retryScheduleSeconds.length;
    const isInvalidPhone = providerError?.providerCode === "INVALID_PHONE";
    const status = canRetry ? "retry" : isInvalidPhone ? "failed" : "dead";
    const retryAfter = providerError?.retryAfterSeconds || retryScheduleSeconds[Math.min(attempt - 1, retryScheduleSeconds.length - 1)];
    const message = (error instanceof Error ? error.message : "Error desconocido al enviar WhatsApp.").slice(0, 1200);

    await supabase
      .from("notification_outbox")
      .update({
        status,
        available_at: canRetry ? new Date(Date.now() + retryAfter * 1000 + Math.floor(Math.random() * 5000)).toISOString() : job.available_at,
        last_error: message,
        provider_response: providerError ? { status: providerError.status, code: providerError.providerCode } : null,
        locked_at: null,
        locked_by: null
      })
      .eq("id", job.id)
      .eq("locked_by", workerId);

    await recordWhatsAppActivity(job, "whatsapp.failed", status, { error: message, retryable, attempt });
    console.error(JSON.stringify({ level: "error", event: "whatsapp.send_failed", job_id: job.id, order_id: job.order_id, recipient_type: job.recipient_type, status, attempt, error: message }));
    return status === "retry" ? "retried" : status;
  }
}

async function recordWhatsAppActivity(job: NotificationOutboxJob, eventType: string, toStatus: string, metadata: Record<string, unknown>) {
  if (!job.order_id) return;
  const supabase = getSupabaseAdmin();
  await supabase.from("activity_events").insert({
    client_id: job.client_id,
    entity_type: "order",
    entity_id: job.order_id,
    event_type: eventType,
    from_status: null,
    to_status: toStatus,
    actor_role: "system",
    metadata: { ...metadata, job_id: job.id, recipient_type: job.recipient_type, trace_id: job.trace_id },
    note: job.recipient_type === "customer" ? "Notificación de WhatsApp al cliente" : "Notificación de WhatsApp al negocio"
  });
}

async function recordWorkerHeartbeat(result: WorkerBatchResult) {
  try {
    const supabase = getSupabaseAdmin();
    await supabase.from("monitoring_events").insert({
      source: "queue",
      level: "info",
      route: "notification-worker",
      message: "Worker de WhatsApp activo",
      metadata: result
    });
  } catch {
    // Monitoring migration is optional for the worker; delivery must continue.
  }
}

async function runWithConcurrency<T>(items: T[], concurrency: number, handler: (item: T) => Promise<void>) {
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await handler(items[index]);
    }
  });
  await Promise.all(runners);
}
