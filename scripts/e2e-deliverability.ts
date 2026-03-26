import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { hash } from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const DATABASE_URL = process.env.DATABASE_URL;
const BASE_URL = process.env.E2E_BASE_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000";
const TEST_EMAIL = "e2e.deliverability@local.test";
const TEST_PASSWORD = "Deliverability!123";
const TEST_NAME = "E2E Deliverability";

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required to run the deliverability E2E test.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: DATABASE_URL }),
});

type InboxKey = "bad" | "good";
type EmailStatus = "DELIVERED" | "OPENED" | "CLICKED" | "BOUNCED" | "SPAM";

interface LeadFixture {
  email: string;
  status: "CONTACTED" | "REPLIED";
}

interface LogFixture {
  leadEmail: string;
  inboxKey: InboxKey;
  status: EmailStatus;
  daysAgo: number;
  hour: number;
}

interface CreatedFixtureLog {
  leadEmail: string;
  leadStatus: LeadFixture["status"];
  inboxId: string;
  domainId: string;
  status: EmailStatus;
  sentAt: Date;
}

interface FixtureState {
  user: {
    id: string;
    email: string;
  };
  domains: Record<InboxKey, { id: string; domainName: string; spfValid: boolean; dkimValid: boolean; dmarcValid: boolean }>;
  inboxes: Record<InboxKey, { id: string; emailAddress: string }>;
  createdLogs: CreatedFixtureLog[];
}

interface MetricsResponse {
  totalSent: number;
  bounceRate: number;
  openRate: number;
  spamRate: number;
  replyRate: number;
  sendingVolume: number;
  healthScore: number;
}

interface TimeSeriesPoint {
  date: string;
  volume: number;
  bounceRate: number;
  openRate: number;
  spamRate: number;
}

interface DomainMetricResponse {
  id: string;
  domainName: string;
  metrics: MetricsResponse;
}

interface DeliverabilityResponse {
  metrics: MetricsResponse;
  timeSeries: TimeSeriesPoint[];
  domainMetrics: DomainMetricResponse[];
}

interface AlertResponse {
  id: string;
  type: string;
  severity: string;
  message: string;
}

const leadFixtures: LeadFixture[] = [
  { email: "bad-bounce-1@fixture.local", status: "CONTACTED" },
  { email: "bad-bounce-2@fixture.local", status: "CONTACTED" },
  { email: "bad-bounce-3@fixture.local", status: "CONTACTED" },
  { email: "bad-bounce-4@fixture.local", status: "CONTACTED" },
  { email: "bad-spam-1@fixture.local", status: "CONTACTED" },
  { email: "bad-spam-2@fixture.local", status: "CONTACTED" },
  { email: "bad-open-1@fixture.local", status: "CONTACTED" },
  { email: "bad-open-2@fixture.local", status: "CONTACTED" },
  { email: "bad-click-1@fixture.local", status: "REPLIED" },
  { email: "bad-delivered-1@fixture.local", status: "CONTACTED" },
  { email: "good-open-1@fixture.local", status: "CONTACTED" },
  { email: "good-click-1@fixture.local", status: "REPLIED" },
  { email: "good-delivered-1@fixture.local", status: "CONTACTED" },
  { email: "good-open-2@fixture.local", status: "REPLIED" },
  { email: "good-open-3@fixture.local", status: "CONTACTED" },
];

const logFixtures: LogFixture[] = [
  { leadEmail: "bad-bounce-1@fixture.local", inboxKey: "bad", status: "BOUNCED", daysAgo: 0, hour: 9 },
  { leadEmail: "bad-bounce-2@fixture.local", inboxKey: "bad", status: "BOUNCED", daysAgo: 0, hour: 10 },
  { leadEmail: "bad-spam-1@fixture.local", inboxKey: "bad", status: "SPAM", daysAgo: 0, hour: 11 },
  { leadEmail: "bad-bounce-3@fixture.local", inboxKey: "bad", status: "BOUNCED", daysAgo: 1, hour: 9 },
  { leadEmail: "bad-spam-2@fixture.local", inboxKey: "bad", status: "SPAM", daysAgo: 1, hour: 10 },
  { leadEmail: "bad-bounce-4@fixture.local", inboxKey: "bad", status: "BOUNCED", daysAgo: 2, hour: 9 },
  { leadEmail: "bad-open-1@fixture.local", inboxKey: "bad", status: "OPENED", daysAgo: 2, hour: 10 },
  { leadEmail: "bad-open-2@fixture.local", inboxKey: "bad", status: "OPENED", daysAgo: 3, hour: 9 },
  { leadEmail: "bad-click-1@fixture.local", inboxKey: "bad", status: "CLICKED", daysAgo: 4, hour: 9 },
  { leadEmail: "bad-delivered-1@fixture.local", inboxKey: "bad", status: "DELIVERED", daysAgo: 5, hour: 9 },
  { leadEmail: "good-open-1@fixture.local", inboxKey: "good", status: "OPENED", daysAgo: 8, hour: 9 },
  { leadEmail: "good-click-1@fixture.local", inboxKey: "good", status: "CLICKED", daysAgo: 10, hour: 9 },
  { leadEmail: "good-delivered-1@fixture.local", inboxKey: "good", status: "DELIVERED", daysAgo: 12, hour: 9 },
  { leadEmail: "good-open-2@fixture.local", inboxKey: "good", status: "OPENED", daysAgo: 15, hour: 9 },
  { leadEmail: "good-open-3@fixture.local", inboxKey: "good", status: "OPENED", daysAgo: 20, hour: 9 },
];

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function buildSentAt(daysAgo: number, hour: number) {
  const sentAt = new Date();
  sentAt.setDate(sentAt.getDate() - daysAgo);
  sentAt.setHours(hour, 0, 0, 0);
  return sentAt;
}

function isoDate(value: Date) {
  return value.toISOString().split("T")[0] ?? "";
}

function getExpectedMetrics(
  logs: CreatedFixtureLog[],
  options: { days: number; domainId?: string; inboxId?: string }
): MetricsResponse {
  const since = new Date();
  since.setDate(since.getDate() - options.days);

  const filteredLogs = logs.filter((log) => {
    if (log.sentAt < since) return false;
    if (options.inboxId) return log.inboxId === options.inboxId;
    if (options.domainId) return log.domainId === options.domainId;
    return true;
  });

  const totalSent = filteredLogs.length;
  if (totalSent === 0) {
    return {
      totalSent: 0,
      bounceRate: 0,
      openRate: 0,
      spamRate: 0,
      replyRate: 0,
      sendingVolume: 0,
      healthScore: 100,
    };
  }

  const bounced = filteredLogs.filter((log) => log.status === "BOUNCED").length;
  const opened = filteredLogs.filter((log) => log.status === "OPENED" || log.status === "CLICKED").length;
  const spam = filteredLogs.filter((log) => log.status === "SPAM").length;

  const repliedLeadEmails = new Set(
    filteredLogs
      .filter((log) => log.leadStatus === "REPLIED")
      .map((log) => log.leadEmail)
  );

  const bounceRate = (bounced / totalSent) * 100;
  const openRate = (opened / totalSent) * 100;
  const spamRate = (spam / totalSent) * 100;
  const replyRate = (repliedLeadEmails.size / totalSent) * 100;
  const healthScore = Math.max(0, Math.min(100, 100 - bounceRate * 2 - spamRate * 3 + openRate * 1.5));

  return {
    totalSent,
    bounceRate: round2(bounceRate),
    openRate: round2(openRate),
    spamRate: round2(spamRate),
    replyRate,
    sendingVolume: totalSent,
    healthScore: round2(healthScore),
  };
}

function getExpectedTimeSeries(
  logs: CreatedFixtureLog[],
  options: { days: number; domainId?: string; inboxId?: string }
) {
  const since = new Date();
  since.setDate(since.getDate() - options.days);

  const filteredLogs = logs.filter((log) => {
    if (log.sentAt < since) return false;
    if (options.inboxId) return log.inboxId === options.inboxId;
    if (options.domainId) return log.domainId === options.domainId;
    return true;
  });

  const dailyMap = new Map<string, { total: number; bounced: number; opened: number; spam: number }>();
  for (const log of filteredLogs) {
    const day = isoDate(log.sentAt);
    const entry = dailyMap.get(day) ?? { total: 0, bounced: 0, opened: 0, spam: 0 };
    entry.total += 1;
    if (log.status === "BOUNCED") entry.bounced += 1;
    if (log.status === "OPENED" || log.status === "CLICKED") entry.opened += 1;
    if (log.status === "SPAM") entry.spam += 1;
    dailyMap.set(day, entry);
  }

  const points: TimeSeriesPoint[] = [];
  const cursor = new Date(since);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date();

  while (cursor <= end) {
    const date = isoDate(cursor);
    const data = dailyMap.get(date) ?? { total: 0, bounced: 0, opened: 0, spam: 0 };

    points.push({
      date,
      volume: data.total,
      bounceRate: data.total > 0 ? round2((data.bounced / data.total) * 100) : 0,
      openRate: data.total > 0 ? round2((data.opened / data.total) * 100) : 0,
      spamRate: data.total > 0 ? round2((data.spam / data.total) * 100) : 0,
    });

    cursor.setDate(cursor.getDate() + 1);
  }

  return points;
}

function splitSetCookieHeader(header: string) {
  return header.split(/,(?=\s*[^;=]+=[^;]+)/g);
}

class CookieJar {
  private readonly cookies = new Map<string, string>();

  addFromResponse(response: Response) {
    const responseHeaders = response.headers as Headers & { getSetCookie?: () => string[] };
    const setCookies =
      typeof responseHeaders.getSetCookie === "function"
        ? responseHeaders.getSetCookie()
        : (() => {
            const singleHeader = response.headers.get("set-cookie");
            return singleHeader ? splitSetCookieHeader(singleHeader) : [];
          })();

    for (const setCookie of setCookies) {
      const firstPart = setCookie.split(";")[0];
      if (!firstPart) continue;

      const separatorIndex = firstPart.indexOf("=");
      if (separatorIndex === -1) continue;

      const name = firstPart.slice(0, separatorIndex);
      const value = firstPart.slice(separatorIndex + 1);
      this.cookies.set(name, value);
    }
  }

  toHeader() {
    return Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }
}

class AppClient {
  private readonly jar = new CookieJar();

  constructor(private readonly baseUrl: string) {}

  async request(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    const cookieHeader = this.jar.toHeader();
    if (cookieHeader) {
      headers.set("Cookie", cookieHeader);
    }

    const response = await fetch(new URL(path, this.baseUrl), {
      ...init,
      headers,
      redirect: init.redirect ?? "manual",
    });

    this.jar.addFromResponse(response);
    return response;
  }

  async getJson<T>(path: string) {
    const response = await this.request(path);
    const body = (await response.json()) as T;
    return { response, body };
  }

  async signIn(email: string, password: string) {
    const csrfResponse = await this.request("/api/auth/csrf");
    assert.equal(csrfResponse.status, 200, "Unable to fetch CSRF token.");
    const csrfPayload = (await csrfResponse.json()) as { csrfToken?: string };
    assert.ok(csrfPayload.csrfToken, "Missing CSRF token.");

    const body = new URLSearchParams({
      email,
      password,
      csrfToken: csrfPayload.csrfToken,
      callbackUrl: `${this.baseUrl}/dashboard`,
    });

    const signInResponse = await this.request("/api/auth/callback/credentials", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Auth-Return-Redirect": "1",
      },
      body,
    });

    assert.equal(signInResponse.status, 200, "Credential sign-in failed.");
    const signInPayload = (await signInResponse.json()) as { url?: string };
    assert.ok(signInPayload.url?.includes("/dashboard"), "Sign-in did not return the dashboard redirect URL.");
  }
}

async function cleanupFixture() {
  const existingUser = await prisma.user.findUnique({
    where: { email: TEST_EMAIL },
    select: { id: true },
  });

  if (!existingUser) return;

  const domains = await prisma.domain.findMany({
    where: { userId: existingUser.id },
    select: { id: true },
  });

  const inboxes = await prisma.inbox.findMany({
    where: { domain: { userId: existingUser.id } },
    select: { id: true },
  });

  const domainIds = domains.map((domain) => domain.id);
  const inboxIds = inboxes.map((inbox) => inbox.id);

  await prisma.$transaction([
    prisma.alert.deleteMany({
      where: {
        OR: [
          { entityType: "domain", entityId: { in: domainIds } },
          { entityType: "inbox", entityId: { in: inboxIds } },
        ],
      },
    }),
    prisma.emailLog.deleteMany({
      where: {
        OR: [
          { campaign: { userId: existingUser.id } },
          { inbox: { domain: { userId: existingUser.id } } },
        ],
      },
    }),
    prisma.lead.deleteMany({
      where: { campaign: { userId: existingUser.id } },
    }),
    prisma.campaign.deleteMany({
      where: { userId: existingUser.id },
    }),
    prisma.inbox.deleteMany({
      where: { domain: { userId: existingUser.id } },
    }),
    prisma.domain.deleteMany({
      where: { userId: existingUser.id },
    }),
    prisma.user.delete({
      where: { id: existingUser.id },
    }),
  ]);
}

async function setupFixture(): Promise<FixtureState> {
  await cleanupFixture();

  const passwordHash = await hash(TEST_PASSWORD, 12);
  const user = await prisma.user.create({
    data: {
      email: TEST_EMAIL,
      name: TEST_NAME,
      passwordHash,
    },
  });

  const runId = randomUUID().slice(0, 8);

  const [badDomain, goodDomain] = await prisma.$transaction([
    prisma.domain.create({
      data: {
        domainName: `deliverability-bad-${runId}.local`,
        status: "ACTIVE",
        spfValid: true,
        dkimValid: false,
        dmarcValid: true,
        userId: user.id,
      },
    }),
    prisma.domain.create({
      data: {
        domainName: `deliverability-good-${runId}.local`,
        status: "ACTIVE",
        spfValid: true,
        dkimValid: true,
        dmarcValid: true,
        userId: user.id,
      },
    }),
  ]);

  const [badInbox, goodInbox] = await prisma.$transaction([
    prisma.inbox.create({
      data: {
        emailAddress: `alerts@${badDomain.domainName}`,
        domainId: badDomain.id,
        smtpHost: "smtp.test.local",
        smtpPort: 587,
        smtpUser: `alerts@${badDomain.domainName}`,
        smtpPass: "password",
        dailyLimit: 50,
        reputationScore: 42,
      },
    }),
    prisma.inbox.create({
      data: {
        emailAddress: `healthy@${goodDomain.domainName}`,
        domainId: goodDomain.id,
        smtpHost: "smtp.test.local",
        smtpPort: 587,
        smtpUser: `healthy@${goodDomain.domainName}`,
        smtpPass: "password",
        dailyLimit: 50,
        reputationScore: 91,
      },
    }),
  ]);

  const campaign = await prisma.campaign.create({
    data: {
      name: `Deliverability E2E ${runId}`,
      subject: "Deliverability fixture",
      bodyTemplate: "<p>Fixture body</p>",
      status: "ACTIVE",
      userId: user.id,
    },
  });

  const leadStatusByEmail = new Map(leadFixtures.map((lead) => [lead.email, lead.status]));

  const leads = await Promise.all(
    leadFixtures.map((lead) =>
      prisma.lead.create({
        data: {
          email: lead.email,
          name: lead.email.split("@")[0],
          company: "Fixture Co",
          status: lead.status,
          campaignId: campaign.id,
        },
      })
    )
  );

  const leadIdByEmail = new Map(leads.map((lead) => [lead.email, lead.id]));

  await Promise.all(
    logFixtures.map((log) => {
      const sentAt = buildSentAt(log.daysAgo, log.hour);
      const openedAt =
        log.status === "OPENED" || log.status === "CLICKED" ? new Date(sentAt.getTime() + 60 * 60 * 1000) : null;
      const clickedAt = log.status === "CLICKED" ? new Date(sentAt.getTime() + 2 * 60 * 60 * 1000) : null;
      const bouncedAt = log.status === "BOUNCED" ? sentAt : null;

      return prisma.emailLog.create({
        data: {
          leadId: leadIdByEmail.get(log.leadEmail) ?? "",
          inboxId: log.inboxKey === "bad" ? badInbox.id : goodInbox.id,
          campaignId: campaign.id,
          subject: "Deliverability fixture",
          body: "<p>Fixture body</p>",
          status: log.status,
          sentAt,
          openedAt,
          clickedAt,
          bouncedAt,
        },
      });
    })
  );

  return {
    user: {
      id: user.id,
      email: user.email,
    },
    domains: {
      bad: {
        id: badDomain.id,
        domainName: badDomain.domainName,
        spfValid: badDomain.spfValid,
        dkimValid: badDomain.dkimValid,
        dmarcValid: badDomain.dmarcValid,
      },
      good: {
        id: goodDomain.id,
        domainName: goodDomain.domainName,
        spfValid: goodDomain.spfValid,
        dkimValid: goodDomain.dkimValid,
        dmarcValid: goodDomain.dmarcValid,
      },
    },
    inboxes: {
      bad: {
        id: badInbox.id,
        emailAddress: badInbox.emailAddress,
      },
      good: {
        id: goodInbox.id,
        emailAddress: goodInbox.emailAddress,
      },
    },
    createdLogs: logFixtures.map((log) => ({
      leadEmail: log.leadEmail,
      leadStatus: leadStatusByEmail.get(log.leadEmail) ?? "CONTACTED",
      inboxId: log.inboxKey === "bad" ? badInbox.id : goodInbox.id,
      domainId: log.inboxKey === "bad" ? badDomain.id : goodDomain.id,
      status: log.status,
      sentAt: buildSentAt(log.daysAgo, log.hour),
    })),
  };
}

function assertMetrics(actual: MetricsResponse, expected: MetricsResponse, label: string) {
  assert.deepEqual(actual, expected, `${label} metrics do not match the expected values.`);
}

function assertTimeSeries(actual: TimeSeriesPoint[], expected: TimeSeriesPoint[], label: string) {
  assert.equal(actual.length, expected.length, `${label} time-series length changed unexpectedly.`);
  assert.equal(
    actual.reduce((sum, point) => sum + point.volume, 0),
    expected.reduce((sum, point) => sum + point.volume, 0),
    `${label} time-series volume does not match the expected total.`
  );

  const expectedByDate = new Map(expected.map((point) => [point.date, point]));
  for (const actualPoint of actual.filter((point) => point.volume > 0)) {
    const expectedPoint = expectedByDate.get(actualPoint.date);
    assert.deepEqual(
      actualPoint,
      expectedPoint,
      `${label} time-series point for ${actualPoint.date} is not correct.`
    );
  }
}

async function runAssertions(fixture: FixtureState) {
  const anonymousClient = new AppClient(BASE_URL);
  const unauthorizedDeliverability = await anonymousClient.request("/api/deliverability?days=7");
  assert.equal(unauthorizedDeliverability.status, 401, "Deliverability API should reject anonymous access.");

  const client = new AppClient(BASE_URL);
  await client.signIn(TEST_EMAIL, TEST_PASSWORD);

  const sessionResult = await client.getJson<{ user?: { id?: string; email?: string } }>("/api/auth/session");
  assert.equal(sessionResult.response.status, 200, "Authenticated session request failed.");
  assert.equal(sessionResult.body.user?.email, TEST_EMAIL, "Authenticated session does not belong to the test user.");

  const domainsResult = await client.getJson<
    Array<{
      id: string;
      domainName: string;
      spfValid: boolean;
      dkimValid: boolean;
      dmarcValid: boolean;
    }>
  >("/api/domains");

  assert.equal(domainsResult.response.status, 200, "Domains API failed for the authenticated user.");
  assert.equal(domainsResult.body.length, 2, "The test user should expose exactly two domains.");

  const badDomainFromApi = domainsResult.body.find((domain) => domain.id === fixture.domains.bad.id);
  const goodDomainFromApi = domainsResult.body.find((domain) => domain.id === fixture.domains.good.id);

  assert.deepEqual(
    badDomainFromApi && {
      spfValid: badDomainFromApi.spfValid,
      dkimValid: badDomainFromApi.dkimValid,
      dmarcValid: badDomainFromApi.dmarcValid,
    },
    {
      spfValid: fixture.domains.bad.spfValid,
      dkimValid: fixture.domains.bad.dkimValid,
      dmarcValid: fixture.domains.bad.dmarcValid,
    },
    "Bad domain DNS flags are not surfaced correctly."
  );
  assert.deepEqual(
    goodDomainFromApi && {
      spfValid: goodDomainFromApi.spfValid,
      dkimValid: goodDomainFromApi.dkimValid,
      dmarcValid: goodDomainFromApi.dmarcValid,
    },
    {
      spfValid: fixture.domains.good.spfValid,
      dkimValid: fixture.domains.good.dkimValid,
      dmarcValid: fixture.domains.good.dmarcValid,
    },
    "Good domain DNS flags are not surfaced correctly."
  );

  const all30ExpectedMetrics = getExpectedMetrics(fixture.createdLogs, { days: 30 });
  const all30ExpectedTimeSeries = getExpectedTimeSeries(fixture.createdLogs, { days: 30 });
  const all30Result = await client.getJson<DeliverabilityResponse>("/api/deliverability?days=30");
  assert.equal(all30Result.response.status, 200, "Deliverability 30-day API request failed.");
  assertMetrics(all30Result.body.metrics, all30ExpectedMetrics, "30-day aggregate");
  assertTimeSeries(all30Result.body.timeSeries, all30ExpectedTimeSeries, "30-day aggregate");

  const domainMetricMap = new Map(all30Result.body.domainMetrics.map((item) => [item.id, item.metrics]));
  assertMetrics(
    domainMetricMap.get(fixture.domains.bad.id) as MetricsResponse,
    getExpectedMetrics(fixture.createdLogs, { days: 30, domainId: fixture.domains.bad.id }),
    "30-day bad domain"
  );
  assertMetrics(
    domainMetricMap.get(fixture.domains.good.id) as MetricsResponse,
    getExpectedMetrics(fixture.createdLogs, { days: 30, domainId: fixture.domains.good.id }),
    "30-day good domain"
  );

  const all7ExpectedMetrics = getExpectedMetrics(fixture.createdLogs, { days: 7 });
  const all7ExpectedTimeSeries = getExpectedTimeSeries(fixture.createdLogs, { days: 7 });
  const all7Result = await client.getJson<DeliverabilityResponse>("/api/deliverability?days=7");
  assert.equal(all7Result.response.status, 200, "Deliverability 7-day API request failed.");
  assertMetrics(all7Result.body.metrics, all7ExpectedMetrics, "7-day aggregate");
  assertTimeSeries(all7Result.body.timeSeries, all7ExpectedTimeSeries, "7-day aggregate");

  const badDomain7Result = await client.getJson<DeliverabilityResponse>(
    `/api/deliverability?days=7&domainId=${fixture.domains.bad.id}`
  );
  assert.equal(badDomain7Result.response.status, 200, "Bad domain deliverability API request failed.");
  assertMetrics(
    badDomain7Result.body.metrics,
    getExpectedMetrics(fixture.createdLogs, { days: 7, domainId: fixture.domains.bad.id }),
    "7-day bad domain"
  );

  const goodDomain7Result = await client.getJson<DeliverabilityResponse>(
    `/api/deliverability?days=7&domainId=${fixture.domains.good.id}`
  );
  assert.equal(goodDomain7Result.response.status, 200, "Good domain deliverability API request failed.");
  assertMetrics(
    goodDomain7Result.body.metrics,
    getExpectedMetrics(fixture.createdLogs, { days: 7, domainId: fixture.domains.good.id }),
    "7-day good domain"
  );

  const badInbox7Result = await client.getJson<DeliverabilityResponse>(
    `/api/deliverability?days=7&inboxId=${fixture.inboxes.bad.id}`
  );
  assert.equal(badInbox7Result.response.status, 200, "Bad inbox deliverability API request failed.");
  assertMetrics(
    badInbox7Result.body.metrics,
    getExpectedMetrics(fixture.createdLogs, { days: 7, inboxId: fixture.inboxes.bad.id }),
    "7-day bad inbox"
  );

  const missingDomainResult = await client.request(`/api/deliverability?days=7&domainId=missing-domain-id`);
  assert.equal(missingDomainResult.status, 404, "Unknown domainId should return 404.");

  const missingInboxResult = await client.request(`/api/deliverability?days=7&inboxId=missing-inbox-id`);
  assert.equal(missingInboxResult.status, 404, "Unknown inboxId should return 404.");

  const alertsResult = await client.getJson<AlertResponse[]>("/api/deliverability/alerts");
  assert.equal(alertsResult.response.status, 200, "Deliverability alerts API request failed.");

  const alertIds = alertsResult.body.map((alert) => alert.id).sort();
  assert.deepEqual(
    alertIds,
    [
      `bounce-${fixture.inboxes.bad.id}`,
      `health-${fixture.domains.bad.id}`,
      `spam-${fixture.inboxes.bad.id}`,
    ].sort(),
    "Deliverability alerts did not match the expected inbox/domain thresholds."
  );

  const alertSeverities = new Map(alertsResult.body.map((alert) => [alert.id, alert.severity]));
  assert.equal(alertSeverities.get(`bounce-${fixture.inboxes.bad.id}`), "critical", "Bounce alert should be critical.");
  assert.equal(alertSeverities.get(`health-${fixture.domains.bad.id}`), "critical", "Health alert should be critical.");
  assert.equal(alertSeverities.get(`spam-${fixture.inboxes.bad.id}`), "critical", "Spam alert should be critical.");

  console.log("Deliverability E2E passed.");
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Authenticated user: ${fixture.user.email}`);
  console.log(`7-day metrics: ${JSON.stringify(all7Result.body.metrics)}`);
  console.log(`30-day metrics: ${JSON.stringify(all30Result.body.metrics)}`);
  console.log(`Alert IDs: ${alertIds.join(", ")}`);
}

async function main() {
  let fixture: FixtureState | null = null;

  try {
    fixture = await setupFixture();
    await runAssertions(fixture);
  } finally {
    await cleanupFixture();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exit(1);
});
