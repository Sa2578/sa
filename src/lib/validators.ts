import { z } from "zod";

const nullableTrimmedString = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}, z.string().max(255).nullable().optional());

const nullableEmail = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim().toLowerCase();
  return trimmed === "" ? null : trimmed;
}, z.string().email().nullable().optional());

export const domainSchema = z.object({
  domainName: z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .max(255)
    .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i, "Invalid domain name"),
  status: z.enum(["ACTIVE", "WARMUP", "FLAGGED", "PAUSED"]).optional(),
  spfValid: z.boolean().optional(),
  dkimValid: z.boolean().optional(),
  dmarcValid: z.boolean().optional(),
  dkimSelectors: z
    .array(
      z
        .string()
        .trim()
        .toLowerCase()
        .min(1)
        .max(63)
        .regex(/^[a-z0-9._-]+$/i, "Invalid DKIM selector")
    )
    .max(10)
    .optional(),
});

export const inboxSchema = z.object({
  emailAddress: z.string().trim().toLowerCase().email(),
  domainId: z.string().min(1),
  senderName: nullableTrimmedString,
  replyToEmail: nullableEmail,
  smtpHost: z.string().trim().toLowerCase().min(1),
  smtpPort: z.number().int().min(1).max(65535).default(587),
  smtpUser: z.string().trim().min(1),
  smtpPass: z.string().trim().min(1),
  dailyLimit: z.number().int().min(1).default(50),
  warmupStatus: z.enum(["NONE", "IN_PROGRESS", "COMPLETED"]).optional(),
  isActive: z.boolean().optional(),
});

export const campaignSchema = z.object({
  name: z.string().trim().min(1).max(255),
  subject: z.string().trim().min(1),
  bodyTemplate: z.string().trim().min(1),
  sendingSchedule: z.any().optional(),
  status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "COMPLETED"]).optional(),
});

export const leadSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().optional(),
  company: z.string().trim().optional(),
});
