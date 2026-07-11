import { createHmac, timingSafeEqual } from "node:crypto";
import { getConfig } from "../../config.js";
import { ApiError } from "../../lib/api-error.js";
import { getSupabaseAdmin } from "../../lib/supabase.js";

const statusRank: Record<string, number> = { processing: 0, sent: 1, delivered: 2, read: 3, failed: 4, dead: 5 };

export function verifyWebhookChallenge(query: URLSearchParams) {
  const config = getConfig();
  const mode = query.get("hub.mode");
  const token = query.get("hub.verify_token");
  const challenge = query.get("hub.challenge");

  if (!config.metaWebhookVerifyToken) throw new ApiError("Falta META_WEBHOOK_VERIFY_TOKEN.", 503, "WEBHOOK_NOT_CONFIGURED");
  if (mode !== "subscribe" || token !== config.metaWebhookVerifyToken || !challenge) throw new ApiError("Verificación de webhook rechazada.", 403, "WEBHOOK_VERIFY_FAILED");
  return challenge;
}

export function verifyMetaSignature(rawBody: Buffer, signatureHeader: string | undefined, secret = getConfig().metaAppSecret) {
  if (!secret || !signatureHeader?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const received = signatureHeader.slice("sha256=".length);
  if (!/^[a-f0-9]{64}$/i.test(received)) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
}

export async function processWhatsAppWebhook(rawBody: Buffer, signatureHeader?: string) {
  if (!verifyMetaSignature(rawBody, signatureHeader)) throw new ApiError("Firma de webhook inválida.", 401, "INVALID_WEBHOOK_SIGNATURE");

  let payload: Record<string, any>;
  try {
    payload = JSON.parse(rawBody.toString("utf8")) as Record<string, any>;
  } catch {
    throw new ApiError("El webhook no contiene JSON válido.", 400, "INVALID_WEBHOOK_BODY");
  }

  const statuses = extractStatuses(payload);
  const supabase = getSupabaseAdmin();
  let updated = 0;

  for (const item of statuses) {
    const providerMessageId = String(item.id || "");
    const nextStatus = mapStatus(item.status);
    if (!providerMessageId || !nextStatus) continue;

    const { data: current } = await supabase
      .from("notification_outbox")
      .select("id,status,order_id,client_id,recipient_type")
      .eq("provider_message_id", providerMessageId)
      .maybeSingle();
    if (!current) continue;

    if (nextStatus !== "failed" && (statusRank[current.status] || 0) > statusRank[nextStatus]) continue;

    const eventTime = toIsoTime(item.timestamp);
    const patch: Record<string, unknown> = {
      status: nextStatus,
      provider_response: { webhook_status: item.status, conversation: item.conversation || null, pricing: item.pricing || null },
      last_error: nextStatus === "failed" ? getFailureMessage(item) : null
    };
    if (nextStatus === "sent") patch.sent_at = eventTime;
    if (nextStatus === "delivered") patch.delivered_at = eventTime;
    if (nextStatus === "read") patch.read_at = eventTime;

    const { error } = await supabase.from("notification_outbox").update(patch).eq("id", current.id);
    if (error) continue;
    updated += 1;

    if (current.order_id && ["sent", "delivered", "read"].includes(nextStatus)) {
      await supabase.from("orders").update({ whatsapp_sent: true }).eq("id", current.order_id);
    }
  }

  console.log(JSON.stringify({ level: "info", event: "whatsapp.webhook_processed", received: statuses.length, updated }));
  return { received: statuses.length, updated };
}

function extractStatuses(payload: Record<string, any>) {
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  return entries.flatMap((entry: any) => {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    return changes.flatMap((change: any) => Array.isArray(change?.value?.statuses) ? change.value.statuses : []);
  });
}

function mapStatus(status: unknown): "sent" | "delivered" | "read" | "failed" | null {
  if (status === "sent" || status === "delivered" || status === "read" || status === "failed") return status;
  return null;
}

function toIsoTime(timestamp: unknown) {
  const seconds = Number(timestamp);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : new Date().toISOString();
}

function getFailureMessage(item: Record<string, any>) {
  const errors = Array.isArray(item.errors) ? item.errors : [];
  const first = errors[0] || {};
  return String(first.title || first.message || first.error_data?.details || "WhatsApp informó que el mensaje falló.").slice(0, 1200);
}
