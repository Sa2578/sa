import { Prisma } from "@prisma/client";

export const publicInboxSelect = {
  id: true,
  emailAddress: true,
  senderName: true,
  replyToEmail: true,
  smtpHost: true,
  smtpPort: true,
  lastSmtpVerifiedAt: true,
  smtpLastError: true,
  dailyLimit: true,
  sentToday: true,
  warmupStatus: true,
  reputationScore: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.InboxSelect;

export const publicInboxWithDomainSelect = {
  ...publicInboxSelect,
  domain: {
    select: {
      id: true,
      domainName: true,
    },
  },
} satisfies Prisma.InboxSelect;

export const publicDomainInboxSelect = {
  id: true,
  emailAddress: true,
  senderName: true,
  dailyLimit: true,
  sentToday: true,
  warmupStatus: true,
  reputationScore: true,
  isActive: true,
} satisfies Prisma.InboxSelect;
