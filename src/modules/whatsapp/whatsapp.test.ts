import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { normalizeE164 } from "./whatsapp.client.js";
import { verifyMetaSignature } from "./whatsapp.webhook.js";

test("normaliza números peruanos a E.164", () => {
  assert.equal(normalizeE164("999 888 777"), "51999888777");
  assert.equal(normalizeE164("+51 999-888-777"), "51999888777");
  assert.equal(normalizeE164("123"), null);
});

test("valida la firma HMAC-SHA256 del webhook", () => {
  const secret = "simi-test-secret";
  const body = Buffer.from('{"object":"whatsapp_business_account"}', "utf8");
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  assert.equal(verifyMetaSignature(body, signature, secret), true);
  assert.equal(verifyMetaSignature(body, "sha256=" + "0".repeat(64), secret), false);
  assert.equal(verifyMetaSignature(body, undefined, secret), false);
});
