import cors from "cors";
import express from "express";
import { getConfig } from "./config.js";
import { ApiError } from "./lib/api-error.js";
import { registerLead, type LeadPayload } from "./modules/leads/lead.service.js";
import { processWhatsAppWebhook, verifyWebhookChallenge } from "./modules/whatsapp/whatsapp.webhook.js";
import { getHealth } from "./services/health.service.js";
import { processOutboxBatch } from "./services/outbox.service.js";

const app = express();
const config = getConfig();

app.use((_request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});
app.use(cors({ origin: config.simiWebOrigin === "*" ? true : config.simiWebOrigin.split(",").map((item) => item.trim()) }));

app.get("/health", async (_request, response) => {
  const health = await getHealth();
  response.status(health.ok ? 200 : 503).json(health);
});

app.get("/webhooks/whatsapp", (request, response) => {
  try {
    const query = new URLSearchParams(Object.entries(request.query).map(([key, value]) => [key, String(value || "")]));
    response.status(200).send(verifyWebhookChallenge(query));
  } catch (error) {
    sendExpressError(response, error);
  }
});

app.post("/webhooks/whatsapp", express.raw({ type: "application/json", limit: "1mb" }), async (request, response) => {
  try {
    const rawBody = Buffer.isBuffer(request.body) ? request.body : Buffer.from("");
    const result = await processWhatsAppWebhook(rawBody, request.header("x-hub-signature-256"));
    response.status(200).json({ ok: true, ...result });
  } catch (error) {
    sendExpressError(response, error);
  }
});

app.get("/api/internal/notifications/process", processNotifications);
app.post("/api/internal/notifications/process", processNotifications);

app.use(express.json({ limit: "1mb" }));

app.post("/api/leads", async (request, response) => {
  try {
    const result = await registerLead(request.body as LeadPayload);
    response.status(201).json({ ok: true, ...result });
  } catch (error) {
    sendExpressError(response, error);
  }
});

async function processNotifications(request: express.Request, response: express.Response) {
  try {
    requireWorkerAuthorization(request.header("authorization"));
    const limit = Number(request.query.limit || 20);
    const result = await processOutboxBatch(limit);
    response.status(200).json({ ok: true, ...result });
  } catch (error) {
    sendExpressError(response, error);
  }
}

function requireWorkerAuthorization(authorization?: string) {
  const workerToken = getConfig().workerToken;
  if (!workerToken || authorization !== `Bearer ${workerToken}`) throw new ApiError("No autorizado.", 401, "UNAUTHORIZED");
}

function sendExpressError(response: express.Response, error: unknown) {
  const status = error instanceof ApiError ? error.status : 500;
  const code = error instanceof ApiError ? error.code : "INTERNAL_ERROR";
  const message = error instanceof Error ? error.message : "Error inesperado.";
  if (status >= 500) console.error(JSON.stringify({ level: "error", event: "api.request_failed", code, message }));
  response.status(status).json({ error: message, code });
}

export default app;
