import { ApiError } from "../../lib/api-error.js";
import { getSupabaseAdmin } from "../../lib/supabase.js";

export type LeadPayload = {
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

export async function registerLead(payload: LeadPayload) {
  const businessName = cleanText(payload.businessName);
  const whatsapp = cleanText(payload.whatsapp);
  const businessType = cleanText(payload.businessType || "restaurant");
  const city = cleanText(payload.city || "Huancayo");

  if (!businessName || businessName.length < 2) throw new ApiError("Ingresa el nombre del negocio.");
  if (!isValidPeruPhone(whatsapp)) throw new ApiError("Ingresa un WhatsApp válido de Perú.");

  const supabase = getSupabaseAdmin();
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

  if (error || !data) {
    console.error(JSON.stringify({ level: "error", event: "lead.create_failed", code: error?.code, message: error?.message }));
    throw new ApiError("No se pudo guardar el lead.", 500, "LEAD_CREATE_FAILED");
  }

  return { id: data.id };
}

function cleanText(value: unknown) {
  return String(value || "").trim().slice(0, 500);
}

function isValidPeruPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return /^(51)?9\d{8}$/.test(digits);
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
