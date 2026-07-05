import cors from "cors";
import express from "express";
import { createClient } from "@supabase/supabase-js";

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

const app = express();
const allowedOrigin = process.env.SIMI_WEB_ORIGIN || "*";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = supabaseUrl && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
  : null;

app.use((_request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});
app.use(express.json({ limit: "1mb" }));
app.use(cors({ origin: allowedOrigin === "*" ? true : allowedOrigin.split(",").map((item) => item.trim()) }));

app.get("/health", (_request, response) => {
  response.json({ ok: true, service: "simi-api" });
});

app.post("/api/leads", async (request, response) => {
  try {
    if (!supabase) {
      response.status(500).json({ error: "API no configurada. Faltan variables de Supabase." });
      return;
    }

    const payload = request.body as LeadPayload;
    const businessName = cleanText(payload.businessName);
    const whatsapp = cleanText(payload.whatsapp);
    const businessType = cleanText(payload.businessType || "restaurant");
    const city = cleanText(payload.city || "Huancayo");

    if (!businessName || businessName.length < 2) {
      response.status(400).json({ error: "Ingresa el nombre del negocio." });
      return;
    }

    if (!isValidPeruPhone(whatsapp)) {
      response.status(400).json({ error: "Ingresa un WhatsApp valido de Peru." });
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
      response.status(500).json({ error: "No se pudo guardar el lead." });
      return;
    }

    response.status(201).json({ ok: true, id: data.id });
  } catch (error) {
    console.error("Error inesperado en leads.", error);
    response.status(500).json({ error: "Error inesperado al registrar el lead." });
  }
});

export default app;

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
