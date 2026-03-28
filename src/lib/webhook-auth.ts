import { getWebhookSecret } from "./env";

export function isWebhookAuthorized(req: Request) {
  const expectedSecret = getWebhookSecret();
  if (!expectedSecret) return true;

  const suppliedSecret =
    req.headers.get("x-webhook-secret") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  return suppliedSecret === expectedSecret;
}
