import { prisma } from "./prisma";
import {
  BOUNCE_RATE_CRITICAL,
  BOUNCE_RATE_WARNING,
  HEALTH_SCORE_CRITICAL,
  HEALTH_SCORE_WARNING,
  SPAM_RATE_CRITICAL,
  SPAM_RATE_WARNING,
} from "./constants";
import {
  classifyRecipientProvider,
  detectSendingHostProvider,
  formatProviderLabel,
} from "./provider-detection";

const ALERT_WINDOW_DAYS = 7;
const ALERT_COMPARISON_WINDOW_DAYS = 14;
const PROVIDER_DRIFT_MIN_VOLUME = 15;
const PROVIDER_CLICK_DROP_MIN_ABSOLUTE = 1.5;
const PROVIDER_REPLY_DROP_MIN_ABSOLUTE = 0.75;
const PROVIDER_DROP_RATIO_WARNING = 0.6;
const PROVIDER_DROP_RATIO_CRITICAL = 0.35;

export interface DeliverabilityMetrics {
  totalSent: number;
  bounceRate: number;
  openRate: number;
  verifiedOpenRate: number;
  clickRate: number;
  proxyOpenRate: number;
  spamRate: number;
  replyRate: number;
  placementSampleSize: number;
  placementCoverageRate: number;
  inboxPlacementRate: number;
  promotionsPlacementRate: number;
  spamPlacementRate: number;
  sendingVolume: number;
  healthScore: number;
}

export interface DeliverabilityTimeSeriesPoint {
  date: string;
  volume: number;
  bounceRate: number;
  openRate: number;
  verifiedOpenRate: number;
  clickRate: number;
  proxyOpenRate: number;
  spamRate: number;
}

export interface DeliverabilityDomainMetric {
  id: string;
  domainName: string;
  metrics: DeliverabilityMetrics;
}

export interface DeliverabilityInboxMetric {
  id: string;
  emailAddress: string;
  sendingHost: string;
  sendingHostLabel: string;
  metrics: DeliverabilityMetrics;
}

export interface DeliverabilityCampaignMetric {
  id: string;
  name: string;
  isSystem: boolean;
  metrics: DeliverabilityMetrics;
}

export interface DeliverabilityRecipientProviderMetric {
  provider: string;
  label: string;
  metrics: DeliverabilityMetrics;
}

export interface DeliverabilitySendingHostMetric {
  host: string;
  label: string;
  inboxCount: number;
  domainCount: number;
  metrics: DeliverabilityMetrics;
}

export interface DeliverabilityCohortMetric {
  id: string;
  date: string;
  campaignId: string | null;
  campaignName: string;
  senderDomainId: string | null;
  senderDomain: string;
  inboxId: string | null;
  sendingInbox: string;
  sendingHost: string;
  sendingHostLabel: string;
  recipientProvider: string;
  recipientProviderLabel: string;
  totalSent: number;
  bounceRate: number;
  clickRate: number;
  replyRate: number;
  spamRate: number;
  inboxPlacementRate: number;
  spamPlacementRate: number;
  placementSampleSize: number;
  healthScore: number;
}

export interface DeliverabilityOverview {
  metrics: DeliverabilityMetrics;
  timeSeries: DeliverabilityTimeSeriesPoint[];
  domainMetrics: DeliverabilityDomainMetric[];
  inboxMetrics: DeliverabilityInboxMetric[];
  campaignMetrics: DeliverabilityCampaignMetric[];
  recipientProviderMetrics: DeliverabilityRecipientProviderMetric[];
  sendingHostMetrics: DeliverabilitySendingHostMetric[];
  cohortMetrics: DeliverabilityCohortMetric[];
}

interface DeliverabilityScope {
  userId?: string;
  domainId?: string;
  inboxId?: string;
  campaignId?: string;
  days?: number;
}

interface MetricEventRecord {
  eventType: string;
  payload: unknown;
}

interface MetricLogRecord {
  id: string;
  status: string;
  repliedAt: Date | null;
  sentAt: Date | null;
  events: MetricEventRecord[];
}

interface OverviewLogRecord extends MetricLogRecord {
  lead: {
    email: string;
  };
  inbox: {
    id: string;
    emailAddress: string;
    smtpHost: string;
    domain: {
      id: string;
      domainName: string;
    };
  };
  campaign: {
    id: string;
    name: string;
    isSystem: boolean;
  };
}

function roundRate(value: number) {
  return Math.round(value * 100) / 100;
}

function getSince(days: number) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  return since;
}

function buildEmailLogWhere(options: {
  userId?: string;
  domainId?: string;
  inboxId?: string;
  campaignId?: string;
  since: Date;
}) {
  const { userId, domainId, inboxId, campaignId, since } = options;
  const where: Record<string, unknown> = {
    sentAt: { gte: since },
    status: { not: "QUEUED" },
  };

  if (inboxId) {
    where.inboxId = inboxId;
  }

  if (campaignId) {
    where.campaignId = campaignId;
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

function emptyMetrics(): DeliverabilityMetrics {
  return {
    totalSent: 0,
    bounceRate: 0,
    openRate: 0,
    verifiedOpenRate: 0,
    clickRate: 0,
    proxyOpenRate: 0,
    spamRate: 0,
    replyRate: 0,
    placementSampleSize: 0,
    placementCoverageRate: 0,
    inboxPlacementRate: 0,
    promotionsPlacementRate: 0,
    spamPlacementRate: 0,
    sendingVolume: 0,
    healthScore: 100,
  };
}

function isVerifiedOpenStatus(status: string) {
  return status === "OPENED" || status === "CLICKED";
}

function hasProxyOpen(events: MetricEventRecord[]) {
  return events.some(
    (event) => event.eventType === "open_suspected" || event.eventType === "open_proxy"
  );
}

function getPlacementValue(events: MetricEventRecord[]) {
  const placementEvent = events.find((event) => event.eventType === "header_analysis");
  if (!placementEvent || !placementEvent.payload || typeof placementEvent.payload !== "object") {
    return null;
  }

  const payload = placementEvent.payload as { placement?: unknown };
  return typeof payload.placement === "string" ? payload.placement : null;
}

function computeMetricsFromLogs(logs: MetricLogRecord[]): DeliverabilityMetrics {
  const totalSent = logs.length;
  if (totalSent === 0) {
    return emptyMetrics();
  }

  const bouncedCount = logs.filter((log) => log.status === "BOUNCED").length;
  const verifiedOpenCount = logs.filter((log) => isVerifiedOpenStatus(log.status)).length;
  const clickCount = logs.filter((log) => log.status === "CLICKED").length;
  const spamCount = logs.filter((log) => log.status === "SPAM").length;
  const repliedCount = logs.filter((log) => Boolean(log.repliedAt)).length;
  const proxyOpenCount = logs.filter((log) => hasProxyOpen(log.events)).length;

  const placementValues = logs
    .map((log) => getPlacementValue(log.events))
    .filter((placement): placement is string => Boolean(placement && placement !== "UNKNOWN"));

  const placementSampleSize = placementValues.length;
  const inboxPlacementCount = placementValues.filter((placement) => placement === "INBOX").length;
  const promotionsPlacementCount = placementValues.filter(
    (placement) => placement === "PROMOTIONS"
  ).length;
  const spamPlacementCount = placementValues.filter((placement) => placement === "SPAM").length;

  const bounceRate = (bouncedCount / totalSent) * 100;
  const verifiedOpenRate = (verifiedOpenCount / totalSent) * 100;
  const clickRate = (clickCount / totalSent) * 100;
  const proxyOpenRate = (proxyOpenCount / totalSent) * 100;
  const spamRate = (spamCount / totalSent) * 100;
  const replyRate = (repliedCount / totalSent) * 100;
  const placementCoverageRate = (placementSampleSize / totalSent) * 100;
  const inboxPlacementRate =
    placementSampleSize > 0 ? (inboxPlacementCount / placementSampleSize) * 100 : 0;
  const promotionsPlacementRate =
    placementSampleSize > 0 ? (promotionsPlacementCount / placementSampleSize) * 100 : 0;
  const spamPlacementRate =
    placementSampleSize > 0 ? (spamPlacementCount / placementSampleSize) * 100 : 0;

  const healthScore = Math.max(
    0,
    Math.min(
      100,
      100 -
        bounceRate * 2 -
        spamRate * 3 -
        spamPlacementRate * 1.5 +
        clickRate * 1.5 +
        replyRate * 2 +
        inboxPlacementRate * 0.2
    )
  );

  return {
    totalSent,
    bounceRate: roundRate(bounceRate),
    openRate: roundRate(verifiedOpenRate),
    verifiedOpenRate: roundRate(verifiedOpenRate),
    clickRate: roundRate(clickRate),
    proxyOpenRate: roundRate(proxyOpenRate),
    spamRate: roundRate(spamRate),
    replyRate: roundRate(replyRate),
    placementSampleSize,
    placementCoverageRate: roundRate(placementCoverageRate),
    inboxPlacementRate: roundRate(inboxPlacementRate),
    promotionsPlacementRate: roundRate(promotionsPlacementRate),
    spamPlacementRate: roundRate(spamPlacementRate),
    sendingVolume: totalSent,
    healthScore: roundRate(healthScore),
  };
}

function buildTimeSeries(logs: MetricLogRecord[], since: Date) {
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
    if (isVerifiedOpenStatus(log.status)) entry.verifiedOpened++;
    if (log.status === "CLICKED") entry.clicked++;
    if (hasProxyOpen(log.events)) entry.proxyOpened++;
    if (log.status === "SPAM") entry.spam++;

    dailyMap.set(day, entry);
  }

  const points: DeliverabilityTimeSeriesPoint[] = [];
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
      bounceRate: data.total > 0 ? roundRate((data.bounced / data.total) * 100) : 0,
      openRate: data.total > 0 ? roundRate((data.verifiedOpened / data.total) * 100) : 0,
      verifiedOpenRate:
        data.total > 0 ? roundRate((data.verifiedOpened / data.total) * 100) : 0,
      clickRate: data.total > 0 ? roundRate((data.clicked / data.total) * 100) : 0,
      proxyOpenRate: data.total > 0 ? roundRate((data.proxyOpened / data.total) * 100) : 0,
      spamRate: data.total > 0 ? roundRate((data.spam / data.total) * 100) : 0,
    });

    cursor.setDate(cursor.getDate() + 1);
  }

  return points;
}

function compareByVolume<T extends { metrics: DeliverabilityMetrics }>(
  left: T,
  right: T
) {
  return right.metrics.totalSent - left.metrics.totalSent;
}

function getSendingHost(log: OverviewLogRecord) {
  return detectSendingHostProvider({
    smtpHost: log.inbox.smtpHost,
    emailAddress: log.inbox.emailAddress,
  });
}

function buildDomainMetrics(logs: OverviewLogRecord[]): DeliverabilityDomainMetric[] {
  const groups = new Map<
    string,
    {
      id: string;
      domainName: string;
      logs: OverviewLogRecord[];
    }
  >();

  for (const log of logs) {
    const domainId = log.inbox.domain.id;
    const existing = groups.get(domainId) || {
      id: domainId,
      domainName: log.inbox.domain.domainName,
      logs: [],
    };
    existing.logs.push(log);
    groups.set(domainId, existing);
  }

  return Array.from(groups.values())
    .map((group) => ({
      id: group.id,
      domainName: group.domainName,
      metrics: computeMetricsFromLogs(group.logs),
    }))
    .sort(compareByVolume);
}

function buildInboxMetrics(logs: OverviewLogRecord[]): DeliverabilityInboxMetric[] {
  const groups = new Map<
    string,
    {
      id: string;
      emailAddress: string;
      sendingHost: string;
      logs: OverviewLogRecord[];
    }
  >();

  for (const log of logs) {
    const inboxId = log.inbox.id;
    const existing = groups.get(inboxId) || {
      id: inboxId,
      emailAddress: log.inbox.emailAddress,
      sendingHost: getSendingHost(log),
      logs: [],
    };
    existing.logs.push(log);
    groups.set(inboxId, existing);
  }

  return Array.from(groups.values())
    .map((group) => ({
      id: group.id,
      emailAddress: group.emailAddress,
      sendingHost: group.sendingHost,
      sendingHostLabel: formatProviderLabel(group.sendingHost),
      metrics: computeMetricsFromLogs(group.logs),
    }))
    .sort(compareByVolume);
}

function buildCampaignMetrics(logs: OverviewLogRecord[]): DeliverabilityCampaignMetric[] {
  const groups = new Map<
    string,
    {
      id: string;
      name: string;
      isSystem: boolean;
      logs: OverviewLogRecord[];
    }
  >();

  for (const log of logs) {
    const campaignId = log.campaign.id;
    const existing = groups.get(campaignId) || {
      id: campaignId,
      name: log.campaign.name,
      isSystem: log.campaign.isSystem,
      logs: [],
    };
    existing.logs.push(log);
    groups.set(campaignId, existing);
  }

  return Array.from(groups.values())
    .map((group) => ({
      id: group.id,
      name: group.name,
      isSystem: group.isSystem,
      metrics: computeMetricsFromLogs(group.logs),
    }))
    .sort(compareByVolume);
}

function buildRecipientProviderMetrics(
  logs: OverviewLogRecord[]
): DeliverabilityRecipientProviderMetric[] {
  const groups = new Map<
    string,
    {
      provider: string;
      logs: OverviewLogRecord[];
    }
  >();

  for (const log of logs) {
    const provider = classifyRecipientProvider(log.lead.email);
    const existing = groups.get(provider) || {
      provider,
      logs: [],
    };
    existing.logs.push(log);
    groups.set(provider, existing);
  }

  return Array.from(groups.values())
    .map((group) => ({
      provider: group.provider,
      label: formatProviderLabel(group.provider),
      metrics: computeMetricsFromLogs(group.logs),
    }))
    .sort(compareByVolume);
}

function buildSendingHostMetrics(logs: OverviewLogRecord[]): DeliverabilitySendingHostMetric[] {
  const groups = new Map<
    string,
    {
      host: string;
      inboxIds: Set<string>;
      domainIds: Set<string>;
      logs: OverviewLogRecord[];
    }
  >();

  for (const log of logs) {
    const host = getSendingHost(log);
    const existing = groups.get(host) || {
      host,
      inboxIds: new Set<string>(),
      domainIds: new Set<string>(),
      logs: [],
    };

    existing.inboxIds.add(log.inbox.id);
    existing.domainIds.add(log.inbox.domain.id);
    existing.logs.push(log);
    groups.set(host, existing);
  }

  return Array.from(groups.values())
    .map((group) => ({
      host: group.host,
      label: formatProviderLabel(group.host),
      inboxCount: group.inboxIds.size,
      domainCount: group.domainIds.size,
      metrics: computeMetricsFromLogs(group.logs),
    }))
    .sort(compareByVolume);
}

function buildCohortMetrics(logs: OverviewLogRecord[]): DeliverabilityCohortMetric[] {
  const groups = new Map<
    string,
    {
      id: string;
      date: string;
      campaignId: string | null;
      campaignName: string;
      senderDomainId: string | null;
      senderDomain: string;
      inboxId: string | null;
      sendingInbox: string;
      sendingHost: string;
      recipientProvider: string;
      logs: OverviewLogRecord[];
    }
  >();

  for (const log of logs) {
    if (!log.sentAt) continue;

    const date = log.sentAt.toISOString().split("T")[0];
    const sendingHost = getSendingHost(log);
    const recipientProvider = classifyRecipientProvider(log.lead.email);
    const key = [
      date,
      log.campaign.id,
      log.inbox.domain.id,
      log.inbox.id,
      sendingHost,
      recipientProvider,
    ].join(":");

    const existing = groups.get(key) || {
      id: key,
      date,
      campaignId: log.campaign.id,
      campaignName: log.campaign.name,
      senderDomainId: log.inbox.domain.id,
      senderDomain: log.inbox.domain.domainName,
      inboxId: log.inbox.id,
      sendingInbox: log.inbox.emailAddress,
      sendingHost,
      recipientProvider,
      logs: [],
    };

    existing.logs.push(log);
    groups.set(key, existing);
  }

  return Array.from(groups.values())
    .map((group) => {
      const metrics = computeMetricsFromLogs(group.logs);

      return {
        id: group.id,
        date: group.date,
        campaignId: group.campaignId,
        campaignName: group.campaignName,
        senderDomainId: group.senderDomainId,
        senderDomain: group.senderDomain,
        inboxId: group.inboxId,
        sendingInbox: group.sendingInbox,
        sendingHost: group.sendingHost,
        sendingHostLabel: formatProviderLabel(group.sendingHost),
        recipientProvider: group.recipientProvider,
        recipientProviderLabel: formatProviderLabel(group.recipientProvider),
        totalSent: metrics.totalSent,
        bounceRate: metrics.bounceRate,
        clickRate: metrics.clickRate,
        replyRate: metrics.replyRate,
        spamRate: metrics.spamRate,
        inboxPlacementRate: metrics.inboxPlacementRate,
        spamPlacementRate: metrics.spamPlacementRate,
        placementSampleSize: metrics.placementSampleSize,
        healthScore: metrics.healthScore,
      };
    })
    .sort((left, right) => {
      if (left.date !== right.date) {
        return left.date < right.date ? 1 : -1;
      }
      return right.totalSent - left.totalSent;
    });
}

async function fetchMetricLogs(options: DeliverabilityScope): Promise<MetricLogRecord[]> {
  const { domainId, inboxId, campaignId, days = 30 } = options;
  const since = getSince(days);
  const where = buildEmailLogWhere({
    userId: options.userId,
    domainId,
    inboxId,
    campaignId,
    since,
  });

  return prisma.emailLog.findMany({
    where,
    select: {
      id: true,
      status: true,
      repliedAt: true,
      sentAt: true,
      events: {
        where: { eventType: { in: ["open_suspected", "open_proxy", "header_analysis"] } },
        orderBy: { receivedAt: "desc" },
        select: { eventType: true, payload: true },
      },
    },
  });
}

async function fetchOverviewLogs(options: DeliverabilityScope): Promise<OverviewLogRecord[]> {
  const { domainId, inboxId, campaignId, days = 30 } = options;
  const since = getSince(days);
  const where = buildEmailLogWhere({
    userId: options.userId,
    domainId,
    inboxId,
    campaignId,
    since,
  });

  return prisma.emailLog.findMany({
    where,
    orderBy: { sentAt: "asc" },
    select: {
      id: true,
      status: true,
      repliedAt: true,
      sentAt: true,
      lead: {
        select: {
          email: true,
        },
      },
      inbox: {
        select: {
          id: true,
          emailAddress: true,
          smtpHost: true,
          domain: {
            select: {
              id: true,
              domainName: true,
            },
          },
        },
      },
      campaign: {
        select: {
          id: true,
          name: true,
          isSystem: true,
        },
      },
      events: {
        where: { eventType: { in: ["open_suspected", "open_proxy", "header_analysis"] } },
        orderBy: { receivedAt: "desc" },
        select: { eventType: true, payload: true },
      },
    },
  });
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

function shouldCreateDropAlert(options: {
  currentRate: number;
  previousRate: number;
  currentVolume: number;
  previousVolume: number;
  minimumAbsoluteDrop: number;
}) {
  const { currentRate, previousRate, currentVolume, previousVolume, minimumAbsoluteDrop } = options;

  if (
    currentVolume < PROVIDER_DRIFT_MIN_VOLUME ||
    previousVolume < PROVIDER_DRIFT_MIN_VOLUME ||
    previousRate <= 0
  ) {
    return null;
  }

  const absoluteDrop = previousRate - currentRate;
  if (absoluteDrop < minimumAbsoluteDrop) {
    return null;
  }

  const ratio = currentRate / previousRate;
  if (ratio > PROVIDER_DROP_RATIO_WARNING) {
    return null;
  }

  return ratio <= PROVIDER_DROP_RATIO_CRITICAL ? "critical" : "warning";
}

async function syncProviderDriftAlerts(options: { userId?: string }) {
  const days = ALERT_COMPARISON_WINDOW_DAYS;
  const comparisonLogs = await fetchOverviewLogs({
    userId: options.userId,
    days,
  });

  const currentSince = getSince(ALERT_WINDOW_DAYS);
  const previousSince = getSince(ALERT_COMPARISON_WINDOW_DAYS);
  const scopePrefix = `${options.userId || "global"}:`;
  const managedAlertIds: string[] = [];

  const providerGroups = new Map<
    string,
    {
      current: OverviewLogRecord[];
      previous: OverviewLogRecord[];
    }
  >();

  for (const log of comparisonLogs) {
    if (!log.sentAt) continue;

    const provider = classifyRecipientProvider(log.lead.email);
    const group = providerGroups.get(provider) || { current: [], previous: [] };

    if (log.sentAt >= currentSince) {
      group.current.push(log);
    } else if (log.sentAt >= previousSince) {
      group.previous.push(log);
    }

    providerGroups.set(provider, group);
  }

  for (const [provider, group] of providerGroups.entries()) {
    const currentMetrics = computeMetricsFromLogs(group.current);
    const previousMetrics = computeMetricsFromLogs(group.previous);
    const label = formatProviderLabel(provider);
    const entityId = `${scopePrefix}${provider}`;

    const clickAlertId = `provider-click-drop-${scopePrefix}${provider}`;
    managedAlertIds.push(clickAlertId);
    const clickSeverity = shouldCreateDropAlert({
      currentRate: currentMetrics.clickRate,
      previousRate: previousMetrics.clickRate,
      currentVolume: currentMetrics.totalSent,
      previousVolume: previousMetrics.totalSent,
      minimumAbsoluteDrop: PROVIDER_CLICK_DROP_MIN_ABSOLUTE,
    });

    if (clickSeverity) {
      await upsertAlert({
        id: clickAlertId,
        type: "RECIPIENT_PROVIDER_CLICK_DROP",
        severity: clickSeverity,
        message: `${label} click rate fell from ${previousMetrics.clickRate}% to ${currentMetrics.clickRate}% over the last ${ALERT_WINDOW_DAYS} days`,
        entityType: "recipient_provider",
        entityId,
      });
    } else {
      await resolveAlert(clickAlertId);
    }

    const replyAlertId = `provider-reply-drop-${scopePrefix}${provider}`;
    managedAlertIds.push(replyAlertId);
    const replySeverity = shouldCreateDropAlert({
      currentRate: currentMetrics.replyRate,
      previousRate: previousMetrics.replyRate,
      currentVolume: currentMetrics.totalSent,
      previousVolume: previousMetrics.totalSent,
      minimumAbsoluteDrop: PROVIDER_REPLY_DROP_MIN_ABSOLUTE,
    });

    if (replySeverity) {
      await upsertAlert({
        id: replyAlertId,
        type: "RECIPIENT_PROVIDER_REPLY_DROP",
        severity: replySeverity,
        message: `${label} reply rate fell from ${previousMetrics.replyRate}% to ${currentMetrics.replyRate}% over the last ${ALERT_WINDOW_DAYS} days`,
        entityType: "recipient_provider",
        entityId,
      });
    } else {
      await resolveAlert(replyAlertId);
    }
  }

  if (options.userId) {
    await prisma.alert.updateMany({
      where: {
        resolved: false,
        entityType: "recipient_provider",
        entityId: { startsWith: scopePrefix },
        type: {
          in: ["RECIPIENT_PROVIDER_CLICK_DROP", "RECIPIENT_PROVIDER_REPLY_DROP"],
        },
        ...(managedAlertIds.length > 0 ? { id: { notIn: managedAlertIds } } : {}),
      },
      data: {
        resolved: true,
      },
    });
  }
}

export async function getMetrics(options: DeliverabilityScope): Promise<DeliverabilityMetrics> {
  const logs = await fetchMetricLogs(options);
  return computeMetricsFromLogs(logs);
}

export async function getMetricsOverTime(
  options: DeliverabilityScope
): Promise<DeliverabilityTimeSeriesPoint[]> {
  const logs = await fetchMetricLogs(options);
  return buildTimeSeries(logs, getSince(options.days || 30));
}

export async function getDeliverabilityOverview(
  options: DeliverabilityScope
): Promise<DeliverabilityOverview> {
  const days = options.days || 30;
  const logs = await fetchOverviewLogs(options);

  return {
    metrics: computeMetricsFromLogs(logs),
    timeSeries: buildTimeSeries(logs, getSince(days)),
    domainMetrics: buildDomainMetrics(logs),
    inboxMetrics: buildInboxMetrics(logs),
    campaignMetrics: buildCampaignMetrics(logs),
    recipientProviderMetrics: buildRecipientProviderMetrics(logs),
    sendingHostMetrics: buildSendingHostMetrics(logs),
    cohortMetrics: buildCohortMetrics(logs).slice(0, 200),
  };
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
      days: ALERT_WINDOW_DAYS,
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
      days: ALERT_WINDOW_DAYS,
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

  const campaigns = await prisma.campaign.findMany({
    where: {
      ...(options.userId ? { userId: options.userId } : {}),
      emailLogs: {
        some: {
          sentAt: { gte: getSince(ALERT_WINDOW_DAYS) },
        },
      },
    },
    select: {
      id: true,
      name: true,
    },
  });

  for (const campaign of campaigns) {
    const metrics = await getMetrics({
      userId: options.userId,
      campaignId: campaign.id,
      days: ALERT_WINDOW_DAYS,
    });

    const healthAlertId = `campaign-health-${campaign.id}`;
    if (metrics.totalSent >= 10 && metrics.healthScore < HEALTH_SCORE_WARNING) {
      await upsertAlert({
        id: healthAlertId,
        type: "LOW_CAMPAIGN_HEALTH",
        severity: metrics.healthScore < HEALTH_SCORE_CRITICAL ? "critical" : "warning",
        message: `Campaign ${campaign.name} health score is ${metrics.healthScore}`,
        entityType: "campaign",
        entityId: campaign.id,
      });
    } else {
      await resolveAlert(healthAlertId);
    }
  }

  await syncProviderDriftAlerts(options);
}
