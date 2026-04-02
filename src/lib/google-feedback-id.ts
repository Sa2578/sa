const FEEDBACK_ID_SENDER = "obcrm";

function sanitizeFeedbackPart(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "na";
}

export function buildGoogleFeedbackId(options: {
  campaignId: string;
  userId: string;
  kind?: "campaign" | "system" | "test";
}) {
  const kind = sanitizeFeedbackPart(options.kind || "campaign");
  const campaignId = sanitizeFeedbackPart(options.campaignId);
  const userId = sanitizeFeedbackPart(options.userId);

  return `${campaignId}:${userId}:${kind}:${FEEDBACK_ID_SENDER}`;
}
