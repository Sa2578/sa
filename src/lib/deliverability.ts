import { prisma } from "./prisma";
import {
  BOUNCE_RATE_CRITICAL,
  BOUNCE_RATE_WARNING,
  HEALTH_SCORE_CRITICAL,
  HEALTH_SCORE_WARNING,
  SPAM_RATE_CRITICAL,
  SPAM_RATE_WARNING,
} from "./constants";

export interface DeliverabilityMetrics {
  totalSent: number;
  bounceRate: number;
  openRate: number;
  verifiedOpenRate: number;
  clickRate: number;
  proxyOpenRate: number;
  spamRate: number;
  replyRate: number;
  sendingVolume: number;
  healthScore: number;
}

interface DeliverabilityScope {
  userId?: string;
  domainId?: string;
  inboxId?: string;
  days?: number;
}

function buildEmailLogWhere(options: {
  userId?: string;
  domainId?: string;
  inboxId?: string;
  since: Date;
}) {
  const { userId, domainId, inboxId, since } = options;
  const where: Record<string, unknown> = {
    sentAt: { gte: since },
    status: { not: "QUEUED" },
  };

  if (inboxId) {
    where.inboxId = inboxId;
  }

  const inboxWhere: Record<string, unknown> = {};
  if (domainId) {
    inboxWhere.domainId = domainId;
  }
  if (userId) {
    inboxWhere.domain = { userId };
  }
  if (Object.keys(inboxWhere).length > 0) {
    where.inbox = inboxWhere;
  }

  return where;
}

async function upsertAlert(options: {
  id: string;
  type: string;
  severity: "critical" | "warning";
  message: string;
  entityType: string;
  entityId: string;
}) {
  const { id, type, severity, message, entityType, entityId } = options;

  await prisma.alert.upsert({
    where: { id },
    create: {
      id,
      type,
      severity,
      message,
      entityType,
      entityId,
    },
    update: {
      severity,
      message,
      resolved: false,
    },
  });
}

async function resolveAlert(id: string) {
  await prisma.alert.updateMany({
    where: { id },
    data: { resolved: true },
  });
}

export async function getMetrics(options: DeliverabilityScope): Promise<DeliverabilityMetrics> {
  const { domainId, inboxId, days = 30 } = options;
  const since = new Date();
  since.setDate(since.getDate() - days);

  const where = buildEmailLogWhere({
    userId: options.userId,
    domainId,
    inboxId,
    since,
  });

  const logs = await prisma.emailLog.findMany({
    where,
    select: {
      id: true,
      status: true,
      repliedAt: true,
      events: {
        where: { eventType: "open_suspected" },
        select: { id: true },
        take: 1,
      },
    },
  });

  const totalSent = logs.length;

  if (totalSent === 0) {
    return {
      totalSent: 0,
      bounceRate: 0,
      openRate: 0,
      verifiedOpenRate: 0,
      clickRate: 0,
      proxyOpenRate: 0,
      spamRate: 0,
      replyRate: 0,
      sendingVolume: 0,
      healthScore: 100,
    };
  }

  const bouncedCount = logs.filter((log) => log.status === "BOUNCED").length;
  const verifiedOpenCount = logs.filter(
    (log) => log.status === "OPENED" || log.status === "CLICKED"
  ).length;
  const clickCount = logs.filter((log) => log.status === "CLICKED").length;
  const spamCount = logs.filter((log) => log.status === "SPAM").length;
  const repliedCount = logs.filter((log) => Boolean(log.repliedAt)).length;
  const proxyOpenCount = logs.filter((log) => log.events.length > 0).length;

  const bounceRate = (bouncedCount / totalSent) * 100;
  const verifiedOpenRate = (verifiedOpenCount / totalSent) * 100;
  const clickRate = (clickCount / totalSent) * 100;
  const proxyOpenRate = (proxyOpenCount / totalSent) * 100;
  const spamRate = (spamCount / totalSent) * 100;
  const replyRate = (repliedCount / totalSent) * 100;

  const healthScore = Math.max(
    0,
    Math.min(100, 100 - bounceRate * 2 - spamRate * 3 + clickRate * 1.5 + replyRate * 2)
  );

  return {
    totalSent,
    bounceRate: Math.round(bounceRate * 100) / 100,
    openRate: Math.round(verifiedOpenRate * 100) / 100,
    verifiedOpenRate: Math.round(verifiedOpenRate * 100) / 100,
    clickRate: Math.round(clickRate * 100) / 100,
    proxyOpenRate: Math.round(proxyOpenRate * 100) / 100,
    spamRate: Math.round(spamRate * 100) / 100,
    replyRate: Math.round(replyRate * 100) / 100,
    sendingVolume: totalSent,
    healthScore: Math.round(healthScore * 100) / 100,
  };
}

export async function getMetricsOverTime(options: {
  userId?: string;
  domainId?: string;
  inboxId?: string;
  days?: number;
}) {
  const { domainId, inboxId, days = 30 } = options;
  const since = new Date();
  since.setDate(since.getDate() - days);

  const where = buildEmailLogWhere({
    userId: options.userId,
    domainId,
    inboxId,
    since,
  });

  const logs = await prisma.emailLog.findMany({
    where,
    select: {
      status: true,
      sentAt: true,
      repliedAt: true,
      events: {
        where: { eventType: "open_suspected" },
        select: { id: true },
        take: 1,
      },
    },
    orderBy: { sentAt: "asc" },
  });

  const dailyMap = new Map<
    string,
    {
      total: number;
      bounced: number;
      verifiedOpened: number;
      clicked: number;
      proxyOpened: number;
      spam: number;
    }
  >();

  for (const log of logs) {
    if (!log.sentAt) continue;
    const day = log.sentAt.toISOString().split("T")[0];
    const entry = dailyMap.get(day) || {
      total: 0,
      bounced: 0,
      verifiedOpened: 0,
      clicked: 0,
      proxyOpened: 0,
      spam: 0,
    };
    entry.total++;
    if (log.status === "BOUNCED") entry.bounced++;
    if (log.status === "OPENED" || log.status === "CLICKED") entry.verifiedOpened++;
    if (log.status === "CLICKED") entry.clicked++;
    if (log.events.length > 0) entry.proxyOpened++;
    if (log.status === "SPAM") entry.spam++;
    dailyMap.set(day, entry);
  }

  const points = [];
  const cursor = new Date(since);
  cursor.setHours(0, 0, 0, 0);

  while (cursor <= new Date()) {
    const date = cursor.toISOString().split("T")[0];
    const data = dailyMap.get(date) || {
      total: 0,
      bounced: 0,
      verifiedOpened: 0,
      clicked: 0,
      proxyOpened: 0,
      spam: 0,
    };

    points.push({
      date,
      volume: data.total,
      bounceRate: data.total > 0 ? Math.round((data.bounced / data.total) * 10000) / 100 : 0,
      openRate:
        data.total > 0 ? Math.round((data.verifiedOpened / data.total) * 10000) / 100 : 0,
      verifiedOpenRate:
        data.total > 0 ? Math.round((data.verifiedOpened / data.total) * 10000) / 100 : 0,
      clickRate: data.total > 0 ? Math.round((data.clicked / data.total) * 10000) / 100 : 0,
      proxyOpenRate:
        data.total > 0 ? Math.round((data.proxyOpened / data.total) * 10000) / 100 : 0,
      spamRate: data.total > 0 ? Math.round((data.spam / data.total) * 10000) / 100 : 0,
    });

    cursor.setDate(cursor.getDate() + 1);
  }

  return points;
}

export async function checkAndCreateAlerts(options: { userId?: string } = {}) {
  const inboxes = await prisma.inbox.findMany({
    where: {
      isActive: true,
      ...(options.userId ? { domain: { userId: options.userId } } : {}),
    },
    include: { domain: true },
  });

  for (const inbox of inboxes) {
    const metrics = await getMetrics({
      userId: options.userId,
      inboxId: inbox.id,
      days: 7,
    });

    const bounceAlertId = `bounce-${inbox.id}`;
    if (metrics.totalSent >= 10 && metrics.bounceRate > BOUNCE_RATE_WARNING) {
      await upsertAlert({
        id: bounceAlertId,
        type: "HIGH_BOUNCE",
        severity: metrics.bounceRate > BOUNCE_RATE_CRITICAL ? "critical" : "warning",
        message: `Inbox ${inbox.emailAddress} has a ${metrics.bounceRate}% bounce rate`,
        entityType: "inbox",
        entityId: inbox.id,
      });
    } else {
      await resolveAlert(bounceAlertId);
    }

    const spamAlertId = `spam-${inbox.id}`;
    if (metrics.totalSent >= 10 && metrics.spamRate > SPAM_RATE_WARNING) {
      await upsertAlert({
        id: spamAlertId,
        type: "HIGH_SPAM_RATE",
        severity: metrics.spamRate > SPAM_RATE_CRITICAL ? "critical" : "warning",
        message: `Inbox ${inbox.emailAddress} has a ${metrics.spamRate}% spam rate`,
        entityType: "inbox",
        entityId: inbox.id,
      });
    } else {
      await resolveAlert(spamAlertId);
    }
  }

  const domains = await prisma.domain.findMany({
    where: {
      ...(options.userId ? { userId: options.userId } : {}),
      inboxes: {
        some: { isActive: true },
      },
    },
  });

  for (const domain of domains) {
    const metrics = await getMetrics({
      userId: options.userId,
      domainId: domain.id,
      days: 7,
    });

    const healthAlertId = `health-${domain.id}`;
    if (metrics.totalSent >= 10 && metrics.healthScore < HEALTH_SCORE_WARNING) {
      await upsertAlert({
        id: healthAlertId,
        type: "LOW_HEALTH",
        severity: metrics.healthScore < HEALTH_SCORE_CRITICAL ? "critical" : "warning",
        message: `Domain ${domain.domainName} health score is ${metrics.healthScore}`,
        entityType: "domain",
        entityId: domain.id,
      });
    } else {
      await resolveAlert(healthAlertId);
    }
  }
}
