import { getConfig } from "../src/config.js";
import { ApiError } from "../src/lib/api-error.js";
import { registerLead, type LeadPayload } from "../src/modules/leads/lead.service.js";
import { processWhatsAppWebhook, verifyWebhookChallenge } from "../src/modules/whatsapp/whatsapp.webhook.js";
import { getHealth } from "../src/services/health.service.js";
import { processOutboxBatch } from "../src/services/outbox.service.js";

export default {
  async fetch(request: Request) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: securityHeaders() });
    const url = new URL(request.url);
    const routePath = resolveRoutePath(url);

    try {
      if (request.method === "GET" && ["/health", "/api/health"].includes(routePath)) {
        const health = await getHealth();
        return json(health, health.ok ? 200 : 503);
      }

      if (request.method === "POST" && routePath === "/api/leads") {
        const result = await registerLead(await request.json() as LeadPayload);
        return json({ ok: true, ...result }, 201);
      }

      if (request.method === "GET" && routePath === "/webhooks/whatsapp") {
        return new Response(verifyWebhookChallenge(url.searchParams), { status: 200, headers: { ...securityHeaders(), "Content-Type": "text/plain; charset=utf-8" } });
      }

      if (request.method === "POST" && routePath === "/webhooks/whatsapp") {
        const rawBody = Buffer.from(await request.arrayBuffer());
        const result = await processWhatsAppWebhook(rawBody, request.headers.get("x-hub-signature-256") || undefined);
        return json({ ok: true, ...result }, 200);
      }

      if (["GET", "POST"].includes(request.method) && routePath === "/api/internal/notifications/process") {
        requireWorkerAuthorization(request.headers.get("authorization") || undefined);
        const defaultLimit = request.method === "GET" ? 100 : 20;
        const result = await processOutboxBatch(Number(url.searchParams.get("limit") || defaultLimit));
        return json({ ok: true, ...result }, 200);
      }

      return json({ error: "Ruta no encontrada.", code: "NOT_FOUND" }, 404);
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 500;
      const code = error instanceof ApiError ? error.code : "INTERNAL_ERROR";
      const message = error instanceof Error ? error.message : "Error inesperado.";
      if (status >= 500) console.error(JSON.stringify({ level: "error", event: "api.request_failed", code, message, route: routePath }));
      return json({ error: message, code }, status);
    }
  }
};

function resolveRoutePath(url: URL) {
  const rewrittenPath = url.searchParams.get("simi_path");
  if (!rewrittenPath) return url.pathname;
  return `/${rewrittenPath.replace(/^\/+/, "")}`;
}

function requireWorkerAuthorization(authorization?: string) {
  const workerToken = getConfig().workerToken;
  if (!workerToken || authorization !== `Bearer ${workerToken}`) throw new ApiError("No autorizado.", 401, "UNAUTHORIZED");
}

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: securityHeaders() });
}

function securityHeaders() {
  const origin = getConfig().simiWebOrigin;
  return {
    "Access-Control-Allow-Origin": origin === "*" ? "*" : origin.split(",")[0].trim(),
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type,X-Hub-Signature-256",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
  };
}
