import { getAppUrl } from "./env";

function normalizeBaseUrl() {
  return getAppUrl().replace(/\/$/, "");
}

export function buildTrackingPixelUrl(logId: string) {
  return `${normalizeBaseUrl()}/api/webhooks/tracking?logId=${encodeURIComponent(logId)}&event=open`;
}

export function buildClickTrackingUrl(logId: string, targetUrl: string) {
  return `${normalizeBaseUrl()}/api/webhooks/tracking?logId=${encodeURIComponent(logId)}&event=click&url=${encodeURIComponent(targetUrl)}`;
}

export function wrapTrackedLinks(html: string, logId: string) {
  return html.replace(/href=(["'])(https?:\/\/[^"']+)\1/gi, (_match, quote: string, url: string) => {
    return `href=${quote}${buildClickTrackingUrl(logId, url)}${quote}`;
  });
}
