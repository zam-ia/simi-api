export type OutboxStatus = "pending" | "processing" | "sent" | "delivered" | "read" | "retry" | "failed" | "dead";

export type NotificationOutboxJob = {
  id: string;
  client_id: string;
  order_id: string | null;
  event_type: string;
  channel: "whatsapp";
  recipient_type: "customer" | "business" | "courier";
  recipient_phone: string;
  template_name: string;
  template_language: string;
  payload: Record<string, unknown>;
  status: OutboxStatus;
  attempts: number;
  available_at: string;
  locked_at: string | null;
  locked_by: string | null;
  provider_message_id: string | null;
  provider_response: Record<string, unknown> | null;
  last_error: string | null;
  dedupe_key: string;
  trace_id: string | null;
  created_at: string;
};

export type WhatsAppSendResult = {
  messageId: string;
  response: Record<string, unknown>;
};
