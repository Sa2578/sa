import { getAppUrl } from "./env";

const AUTOMATED_OPEN_USER_AGENT_PATTERNS = [
  /facebookexternalhit/i,
  /python-requests/i,
  /go-http-client/i,
  /\bcurl\b/i,
  /\bwget\b/i,
  /postmanruntime/i,
  /headless/i,
  /phantomjs/i,
  /preview/i,
  /linkexpanding/i,
  /urlscan/i,
  /proofpoint/i,
  /mimecast/i,
  /barracuda/i,
  /symantec/i,
  /trend ?micro/i,
  /safelinks/i,
  /scanner/i,
  /crawler/i,
  /spider/i,
  /\bbot\b/i,
];

const IMAGE_PROXY_USER_AGENT_PATTERNS = [/googleimageproxy/i, /yahoomailproxy/i];
const EARLY_OPEN_WINDOW_MS = 15_000;
const EARLY_PROXY_OPEN_WINDOW_MS = 60_000;

export interface TrackingRequestContext {
  userAgent: string | null;
  accept: string | null;
  referer: string | null;
  forwardedFor: string | null;
  via: string | null;
  secFetchDest: string | null;
  secFetchMode: string | null;
  secFetchSite: string | null;
  purpose: string | null;
  secPurpose: string | null;
  xPurpose: string | null;
}

export interface OpenTrackingClassification {
  suspicious: boolean;
  reasons: string[];
  context: TrackingRequestContext;
}

function normalizeBaseUrl() {
  return getAppUrl().replace(/\/$/, "");
}

export function buildTrackingRequestContext(req: Request): TrackingRequestContext {
  return {
    userAgent: req.headers.get("user-agent"),
    accept: req.headers.get("accept"),
    referer: req.headers.get("referer"),
    forwardedFor: req.headers.get("x-forwarded-for"),
    via: req.headers.get("via"),
    secFetchDest: req.headers.get("sec-fetch-dest"),
    secFetchMode: req.headers.get("sec-fetch-mode"),
    secFetchSite: req.headers.get("sec-fetch-site"),
    purpose: req.headers.get("purpose"),
    secPurpose: req.headers.get("sec-purpose"),
    xPurpose: req.headers.get("x-purpose"),
  };
}

export function classifyOpenTrackingRequest(
  req: Request,
  sentAt?: Date | null
): OpenTrackingClassification {
  const context = buildTrackingRequestContext(req);
  const userAgent = context.userAgent || "";
  const reasons: string[] = [];
  const now = Date.now();
  const ageMs = sentAt ? now - sentAt.getTime() : null;
  const purposeHeaders = [context.purpose, context.secPurpose, context.xPurpose]
    .filter(Boolean)
    .join(" ");

  if (req.method !== "GET") {
    reasons.push("non_get_method");
  }

  if (purposeHeaders && /\bprefetch\b|\bpreview\b/i.test(purposeHeaders)) {
    reasons.push("prefetch_header");
  }

  if (AUTOMATED_OPEN_USER_AGENT_PATTERNS.some((pattern) => pattern.test(userAgent))) {
    reasons.push("automated_user_agent");
  }

  if (IMAGE_PROXY_USER_AGENT_PATTERNS.some((pattern) => pattern.test(userAgent))) {
    reasons.push("image_proxy_user_agent");
  }

  if (ageMs !== null && ageMs >= 0 && ageMs < EARLY_OPEN_WINDOW_MS) {
    reasons.push("too_early_after_send");
  }

  if (
    ageMs !== null &&
    ageMs >= 0 &&
    ageMs < EARLY_PROXY_OPEN_WINDOW_MS &&
    IMAGE_PROXY_USER_AGENT_PATTERNS.some((pattern) => pattern.test(userAgent))
  ) {
    reasons.push("early_image_proxy_fetch");
  }

  return {
    suspicious: reasons.length > 0,
    reasons,
    context,
  };
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
