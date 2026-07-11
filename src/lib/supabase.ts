import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getConfig, hasSupabaseConfig } from "../config.js";

let cachedClient: SupabaseClient | null = null;

export function getSupabaseAdmin() {
  if (cachedClient) return cachedClient;
  const config = getConfig();
  if (!hasSupabaseConfig(config)) throw new Error("Faltan las variables de Supabase en simi-api.");
  cachedClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  return cachedClient;
}
