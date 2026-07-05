import { createClient } from "@supabase/supabase-js";
import type { IncomingMessage, ServerResponse } from "http";

type LeadPayload = {
  businessName?: string;
  whatsapp?: string;
  businessType?: string;
  city?: string;
  message?: string;
  planInterest?: string;
  source?: string;
  utm?: {
    source?: string | null;
    medium?: string | null;
    campaign?: string | null;
    content?: string | null;
    term?: string | null;
  };
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = supabaseUrl && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
  : null;

export default async function handler(request: IncomingMessage & { method?: string; url?: string; body?: unknown }, response: ServerResponse) {
  setSecurityHeaders(response);

  if (request.method === "OPTIONS") {
    response.statusCode = 204;
    response.end();
    return;
  }

  const pathname = new URL(request.url || "/", "https://simi-api.local").pathname;
  if (request.method === "GET" && pathname === "/health") {
    sendJson(response, 200, { ok: true, service: "simi-api" });
    return;
  }

  if (request.method === "POST" && pathname === "/api/leads") {
    await handleLead(request, response);
    return;
  }

  sendJson(response, 404, { error: "Ruta no encontrada." });
}

async function handleLead(request: IncomingMessage & { body?: unknown }, response: ServerResponse) {
  try {
    if (!supabase) {
      sendJson(response, 500, { error: "API no configurada. Faltan variables de Supabase." });
      return;
    }

    const payload = (request.body || await readJsonBody(request)) as LeadPayload;
    const businessName = cleanText(payload.businessName);
    const whatsapp = cleanText(payload.whatsapp);
    const businessType = cleanText(payload.businessType || "restaurant");
    const city = cleanText(payload.city || "Huancayo");

    if (!businessName || businessName.length < 2) {
      sendJson(response, 400, { error: "Ingresa el nombre del negocio." });
      return;
    }

    if (!isValidPeruPhone(whatsapp)) {
      sendJson(response, 400, { error: "Ingresa un WhatsApp valido de Peru." });
      return;
    }

    const { data, error } = await supabase
      .from("demo_requests")
      .insert({
        business_name: businessName,
        business_type: businessType,
        city,
        contact_name: "",
        whatsapp,
        social_url: null,
        comment: buildComment(payload),
        status: "NUEVA",
        plan_interest: cleanText(payload.planInterest || "Pro"),
        owner_email: null
      })
      .select("id")
      .single();

    if (error) {
      console.error("No se pudo registrar lead.", error);
      sendJson(response, 500, { error: "No se pudo guardar el lead." });
      return;
    }

    sendJson(response, 201, { ok: true, id: data.id });
  } catch (error) {
    console.error("Error inesperado en leads.", error);
    sendJson(response, 500, { error: "Error inesperado al registrar el lead." });
  }
}

function setSecurityHeaders(response: ServerResponse) {
  const origin = process.env.SIMI_WEB_ORIGIN || "*";
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

async function readJsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function cleanText(value: unknown) {
  return String(value || "").trim().slice(0, 500);
}

function isValidPeruPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length === 9 || (digits.startsWith("51") && digits.length === 11);
}

function buildComment(payload: LeadPayload) {
  const parts = [
    cleanText(payload.message),
    `Origen: ${cleanText(payload.source || "simi-web")}`,
    payload.utm?.source ? `utm_source: ${cleanText(payload.utm.source)}` : "",
    payload.utm?.medium ? `utm_medium: ${cleanText(payload.utm.medium)}` : "",
    payload.utm?.campaign ? `utm_campaign: ${cleanText(payload.utm.campaign)}` : "",
    payload.utm?.content ? `utm_content: ${cleanText(payload.utm.content)}` : "",
    payload.utm?.term ? `utm_term: ${cleanText(payload.utm.term)}` : ""
  ].filter(Boolean);

  return parts.join("\n");
}
