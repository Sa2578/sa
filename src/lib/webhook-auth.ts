import { getMaintenanceSecret, getWebhookSecret } from "./env";

function isAuthorizedWithSecret(req: Request, expectedSecret: string | null, headerName: string) {
  if (!expectedSecret) return true;

  const url = new URL(req.url);
  const suppliedSecret =
    req.headers.get(headerName) ||
    req.headers.get("x-webhook-secret") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");

  const querySecret = url.searchParams.get("secret");

  return suppliedSecret === expectedSecret || querySecret === expectedSecret;
}

export function isWebhookAuthorized(req: Request) {
  return isAuthorizedWithSecret(req, getWebhookSecret(), "x-webhook-secret");
}

export function isMaintenanceAuthorized(req: Request) {
  return isAuthorizedWithSecret(req, getMaintenanceSecret(), "x-maintenance-secret");
}
