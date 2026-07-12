import { getConfig, hasWhatsAppConfig } from "../../config.js";
import { ApiError } from "../../lib/api-error.js";
import type { NotificationOutboxJob, WhatsAppSendResult } from "./whatsapp.types.js";

export class WhatsAppProviderError extends Error {
  status: number;
  retryable: boolean;
  providerCode: string | null;
  retryAfterSeconds: number | null;

  constructor(message: string, options: { status: number; retryable: boolean; providerCode?: string | null; retryAfterSeconds?: number | null }) {
    super(message);
    this.name = "WhatsAppProviderError";
    this.status = options.status;
    this.retryable = options.retryable;
    this.providerCode = options.providerCode || null;
    this.retryAfterSeconds = options.retryAfterSeconds || null;
  }
}

export async function sendWhatsAppTemplate(job: NotificationOutboxJob): Promise<WhatsAppSendResult> {
  const config = getConfig();
  if (!hasWhatsAppConfig(config)) throw new ApiError("WhatsApp Cloud API todavía no está configurada.", 503, "WHATSAPP_NOT_CONFIGURED");

  const phone = normalizeE164(job.recipient_phone);
  if (!phone) throw new WhatsAppProviderError("El destinatario no tiene un número peruano válido.", { status: 400, retryable: false, providerCode: "INVALID_PHONE" });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(`https://graph.facebook.com/${config.metaGraphVersion}/${config.metaPhoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.metaAccessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(buildTemplateRequest(job, phone)),
      signal: controller.signal
    });

    const body = await readJson(response);
    if (!response.ok) {
      const providerError = asRecord(body.error);
      const code = providerError?.code ? String(providerError.code) : null;
      const message = providerError?.message ? String(providerError.message) : `Meta respondió HTTP ${response.status}.`;
      throw new WhatsAppProviderError(message, {
        status: response.status,
        providerCode: code,
        retryable: response.status === 408 || response.status === 429 || response.status >= 500,
        retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after"))
      });
    }

    const messages = Array.isArray(body.messages) ? body.messages : [];
    const firstMessage = asRecord(messages[0]);
    const messageId = firstMessage?.id ? String(firstMessage.id) : "";
    if (!messageId) throw new WhatsAppProviderError("Meta aceptó la solicitud sin devolver un identificador de mensaje.", { status: 502, retryable: true });

    return { messageId, response: body };
  } catch (error) {
    if (error instanceof WhatsAppProviderError || error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new WhatsAppProviderError("Tiempo de espera agotado al contactar WhatsApp.", { status: 408, retryable: true });
    }
    throw new WhatsAppProviderError(error instanceof Error ? error.message : "Error de red al contactar WhatsApp.", { status: 503, retryable: true });
  } finally {
    clearTimeout(timeout);
  }
}

export function normalizeE164(value: string) {
  const digits = String(value || "").replace(/\D/g, "");
  if (/^9\d{8}$/.test(digits)) return `51${digits}`;
  if (/^519\d{8}$/.test(digits)) return digits;
  return null;
}

function buildTemplateRequest(job: NotificationOutboxJob, phone: string) {
  return {
    messaging_product: "whatsapp",
    to: phone,
    type: "template",
    template: {
      name: job.template_name,
      language: { code: job.template_language || "es" },
      components: [{ type: "body", parameters: getTemplateParameters(job).map((text) => ({ type: "text", text })) }]
    }
  };
}

function getTemplateParameters(job: NotificationOutboxJob) {
  const payload = job.payload || {};
  if (job.recipient_type === "customer") {
    return [payload.customer_name, payload.order_code, payload.business_name, payload.total, payload.status_url].map(toTemplateText);
  }
  if (job.recipient_type === "business") {
    return [payload.order_code, payload.customer_name, payload.total, orderTypeLabel(payload.order_type), payload.admin_url].map(toTemplateText);
  }
  return [payload.order_code, payload.customer_name, payload.delivery_address, payload.admin_url].map(toTemplateText);
}

function orderTypeLabel(value: unknown) {
  if (value === "delivery") return "Delivery";
  if (value === "dine_in") return "Mesa";
  if (value === "pickup") return "Recojo";
  return value;
}

function toTemplateText(value: unknown) {
  return String(value ?? "-").trim().slice(0, 1024) || "-";
}

async function readJson(response: Response): Promise<Record<string, any>> {
  try {
    return await response.json() as Record<string, any>;
  } catch {
    return {};
  }
}

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : null;
}

function parseRetryAfter(value: string | null) {
  if (!value) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : null;
}
