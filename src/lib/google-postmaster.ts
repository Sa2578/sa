import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { getAppUrl, isGooglePostmasterConfigured, requireGooglePostmasterConfig } from "./env";
import { decryptSmtpCredential, encryptSmtpCredential } from "./smtp-credentials";

const GOOGLE_OAUTH_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_POSTMASTER_API_BASE = "https://gmailpostmastertools.googleapis.com/v1";
const GOOGLE_POSTMASTER_SCOPE = "https://www.googleapis.com/auth/postmaster.readonly";

interface GoogleOAuthTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
}

interface GooglePostmasterDomainResource {
  name: string;
  permission?: string;
  createTime?: string;
}

interface GooglePostmasterTrafficStatResource {
  name: string;
  userReportedSpamRatio?: number;
  userReportedSpamRatioLowerBound?: number;
  userReportedSpamRatioUpperBound?: number;
  ipReputations?: unknown;
  domainReputation?: string;
  spammyFeedbackLoops?: unknown;
  spfSuccessRatio?: number;
  dkimSuccessRatio?: number;
  dmarcSuccessRatio?: number;
  outboundEncryptionRatio?: number;
  inboundEncryptionRatio?: number;
  deliveryErrors?: unknown;
}

function getGooglePostmasterCallbackUrl() {
  return `${getAppUrl().replace(/\/$/, "")}/api/deliverability/postmaster/callback`;
}

function parseGoogleApiDateFromResourceName(resourceName: string) {
  const dateToken = resourceName.split("/").pop() || "";
  if (!/^\d{8}$/.test(dateToken)) {
    throw new Error(`Unexpected Google Postmaster traffic stat name: ${resourceName}`);
  }

  const year = Number(dateToken.slice(0, 4));
  const month = Number(dateToken.slice(4, 6)) - 1;
  const day = Number(dateToken.slice(6, 8));
  return new Date(Date.UTC(year, month, day));
}

async function parseGoogleApiError(response: Response, fallbackMessage: string) {
  try {
    const data = await response.json();
    const apiMessage =
      typeof data?.error?.message === "string" ? data.error.message : fallbackMessage;
    return new Error(apiMessage);
  } catch {
    return new Error(fallbackMessage);
  }
}

async function googleFetchJson<T>(input: string, init: RequestInit, fallbackMessage: string) {
  const response = await fetch(input, init);
  if (!response.ok) {
    throw await parseGoogleApiError(response, fallbackMessage);
  }

  return response.json() as Promise<T>;
}

function setGoogleDateQuery(searchParams: URLSearchParams, prefix: string, value: Date) {
  searchParams.set(`${prefix}.year`, String(value.getUTCFullYear()));
  searchParams.set(`${prefix}.month`, String(value.getUTCMonth() + 1));
  searchParams.set(`${prefix}.day`, String(value.getUTCDate()));
}

async function exchangeGooglePostmasterCode(code: string) {
  const { clientId, clientSecret } = requireGooglePostmasterConfig();
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: getGooglePostmasterCallbackUrl(),
    grant_type: "authorization_code",
  });

  return googleFetchJson<GoogleOAuthTokenResponse>(
    GOOGLE_OAUTH_TOKEN_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    },
    "Unable to exchange Google Postmaster OAuth code"
  );
}

async function refreshGooglePostmasterAccessToken(refreshToken: string) {
  const { clientId, clientSecret } = requireGooglePostmasterConfig();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  return googleFetchJson<GoogleOAuthTokenResponse>(
    GOOGLE_OAUTH_TOKEN_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    },
    "Unable to refresh Google Postmaster access token"
  );
}

async function listGooglePostmasterDomains(accessToken: string) {
  const domains: GooglePostmasterDomainResource[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(`${GOOGLE_POSTMASTER_API_BASE}/domains`);
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const data = await googleFetchJson<{
      domains?: GooglePostmasterDomainResource[];
      nextPageToken?: string;
    }>(
      url.toString(),
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      "Unable to list Google Postmaster domains"
    );

    domains.push(...(data.domains || []));
    pageToken = data.nextPageToken || undefined;
  } while (pageToken);

  return domains;
}

async function listGooglePostmasterTrafficStats(
  accessToken: string,
  domainName: string,
  startDate: Date,
  endDateExclusive: Date
) {
  const trafficStats: GooglePostmasterTrafficStatResource[] = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(
      `${GOOGLE_POSTMASTER_API_BASE}/domains/${encodeURIComponent(domainName)}/trafficStats`
    );
    setGoogleDateQuery(url.searchParams, "startDate", startDate);
    setGoogleDateQuery(url.searchParams, "endDate", endDateExclusive);
    url.searchParams.set("pageSize", "200");
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    const data = await googleFetchJson<{
      trafficStats?: GooglePostmasterTrafficStatResource[];
      nextPageToken?: string;
    }>(
      url.toString(),
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      `Unable to load Google Postmaster traffic stats for ${domainName}`
    );

    trafficStats.push(...(data.trafficStats || []));
    pageToken = data.nextPageToken || undefined;
  } while (pageToken);

  return trafficStats;
}

async function getStoredGooglePostmasterAccount(userId: string) {
  return prisma.googlePostmasterAccount.findUnique({
    where: { userId },
  });
}

async function getGooglePostmasterAccessTokenForUser(userId: string) {
  const account = await getStoredGooglePostmasterAccount(userId);
  if (!account) {
    throw new Error("Google Postmaster account not connected");
  }

  const expiresAt = account.accessTokenExpiresAt?.getTime() || 0;
  if (account.encryptedAccessToken && expiresAt > Date.now() + 60_000) {
    return decryptSmtpCredential(account.encryptedAccessToken);
  }

  const refreshToken = decryptSmtpCredential(account.encryptedRefreshToken);
  const refreshed = await refreshGooglePostmasterAccessToken(refreshToken);
  const accessTokenExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000);

  await prisma.googlePostmasterAccount.update({
    where: { id: account.id },
    data: {
      encryptedAccessToken: encryptSmtpCredential(refreshed.access_token),
      accessTokenExpiresAt,
      tokenType: refreshed.token_type || account.tokenType,
      scope: refreshed.scope || account.scope,
      lastSyncError: null,
    },
  });

  return refreshed.access_token;
}

export function createGooglePostmasterAuthorizeUrl(state: string) {
  requireGooglePostmasterConfig();

  const url = new URL(GOOGLE_OAUTH_AUTHORIZE_URL);
  url.searchParams.set("client_id", requireGooglePostmasterConfig().clientId);
  url.searchParams.set("redirect_uri", getGooglePostmasterCallbackUrl());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_POSTMASTER_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);

  return url.toString();
}

export async function connectGooglePostmasterAccount(userId: string, code: string) {
  const tokenResponse = await exchangeGooglePostmasterCode(code);
  const existing = await getStoredGooglePostmasterAccount(userId);

  if (!tokenResponse.refresh_token && !existing?.encryptedRefreshToken) {
    throw new Error(
      "Google did not return a refresh token. Reconnect and ensure consent is granted."
    );
  }

  const accessTokenExpiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000);

  await prisma.googlePostmasterAccount.upsert({
    where: { userId },
    update: {
      encryptedRefreshToken: tokenResponse.refresh_token
        ? encryptSmtpCredential(tokenResponse.refresh_token)
        : existing!.encryptedRefreshToken,
      encryptedAccessToken: encryptSmtpCredential(tokenResponse.access_token),
      accessTokenExpiresAt,
      tokenType: tokenResponse.token_type || existing?.tokenType || null,
      scope: tokenResponse.scope || existing?.scope || null,
      lastSyncError: null,
    },
    create: {
      userId,
      encryptedRefreshToken: encryptSmtpCredential(tokenResponse.refresh_token!),
      encryptedAccessToken: encryptSmtpCredential(tokenResponse.access_token),
      accessTokenExpiresAt,
      tokenType: tokenResponse.token_type || null,
      scope: tokenResponse.scope || null,
    },
  });
}

export async function syncGooglePostmasterData(options: {
  userId: string;
  days?: number;
}) {
  const { userId, days = 30 } = options;

  if (!isGooglePostmasterConfigured()) {
    throw new Error(
      "Google Postmaster is not configured. Set GOOGLE_POSTMASTER_CLIENT_ID and GOOGLE_POSTMASTER_CLIENT_SECRET."
    );
  }

  const account = await getStoredGooglePostmasterAccount(userId);
  if (!account) {
    throw new Error("Google Postmaster account not connected");
  }

  try {
    const accessToken = await getGooglePostmasterAccessTokenForUser(userId);
    const domains = await listGooglePostmasterDomains(accessToken);
    const startDate = new Date();
    startDate.setUTCHours(0, 0, 0, 0);
    startDate.setUTCDate(startDate.getUTCDate() - days);
    const endDateExclusive = new Date();
    endDateExclusive.setUTCHours(0, 0, 0, 0);
    endDateExclusive.setUTCDate(endDateExclusive.getUTCDate() + 1);

    let domainsSynced = 0;
    let statsUpserted = 0;

    for (const domain of domains) {
      const domainName = domain.name.replace(/^domains\//, "");
      const storedDomain = await prisma.googlePostmasterDomain.upsert({
        where: { resourceName: domain.name },
        update: {
          accountId: account.id,
          domainName,
          permission: domain.permission || "NONE",
          lastSyncError: null,
        },
        create: {
          accountId: account.id,
          domainName,
          resourceName: domain.name,
          permission: domain.permission || "NONE",
        },
      });

      try {
        const trafficStats = await listGooglePostmasterTrafficStats(
          accessToken,
          domainName,
          startDate,
          endDateExclusive
        );

        for (const stat of trafficStats) {
          await prisma.googlePostmasterTrafficStat.upsert({
            where: {
              postmasterDomainId_statDate: {
                postmasterDomainId: storedDomain.id,
                statDate: parseGoogleApiDateFromResourceName(stat.name),
              },
            },
            update: {
              resourceName: stat.name,
              domainReputation: stat.domainReputation || null,
              userReportedSpamRatio: stat.userReportedSpamRatio ?? null,
              userReportedSpamRatioLowerBound:
                stat.userReportedSpamRatioLowerBound ?? null,
              userReportedSpamRatioUpperBound:
                stat.userReportedSpamRatioUpperBound ?? null,
              spfSuccessRatio: stat.spfSuccessRatio ?? null,
              dkimSuccessRatio: stat.dkimSuccessRatio ?? null,
              dmarcSuccessRatio: stat.dmarcSuccessRatio ?? null,
              outboundEncryptionRatio: stat.outboundEncryptionRatio ?? null,
              inboundEncryptionRatio: stat.inboundEncryptionRatio ?? null,
              deliveryErrors: normalizeJsonInput(stat.deliveryErrors),
              ipReputations: normalizeJsonInput(stat.ipReputations),
              spammyFeedbackLoops: normalizeJsonInput(stat.spammyFeedbackLoops),
              rawPayload: normalizeJsonInput(stat),
            },
            create: {
              postmasterDomainId: storedDomain.id,
              resourceName: stat.name,
              statDate: parseGoogleApiDateFromResourceName(stat.name),
              domainReputation: stat.domainReputation || null,
              userReportedSpamRatio: stat.userReportedSpamRatio ?? null,
              userReportedSpamRatioLowerBound:
                stat.userReportedSpamRatioLowerBound ?? null,
              userReportedSpamRatioUpperBound:
                stat.userReportedSpamRatioUpperBound ?? null,
              spfSuccessRatio: stat.spfSuccessRatio ?? null,
              dkimSuccessRatio: stat.dkimSuccessRatio ?? null,
              dmarcSuccessRatio: stat.dmarcSuccessRatio ?? null,
              outboundEncryptionRatio: stat.outboundEncryptionRatio ?? null,
              inboundEncryptionRatio: stat.inboundEncryptionRatio ?? null,
              deliveryErrors: normalizeJsonInput(stat.deliveryErrors),
              ipReputations: normalizeJsonInput(stat.ipReputations),
              spammyFeedbackLoops: normalizeJsonInput(stat.spammyFeedbackLoops),
              rawPayload: normalizeJsonInput(stat),
            },
          });

          statsUpserted++;
        }

        await prisma.googlePostmasterDomain.update({
          where: { id: storedDomain.id },
          data: {
            lastSyncedAt: new Date(),
            lastSyncError: null,
          },
        });
        domainsSynced++;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : `Unable to sync Google Postmaster data for ${domainName}`;

        await prisma.googlePostmasterDomain.update({
          where: { id: storedDomain.id },
          data: {
            lastSyncError: message,
          },
        });
      }
    }

    await prisma.googlePostmasterAccount.update({
      where: { id: account.id },
      data: {
        lastSyncedAt: new Date(),
        lastSyncError: null,
      },
    });

    return {
      success: true,
      domainsDiscovered: domains.length,
      domainsSynced,
      statsUpserted,
      windowDays: days,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to sync Google Postmaster data";

    await prisma.googlePostmasterAccount.update({
      where: { id: account.id },
      data: {
        lastSyncError: message,
      },
    });

    throw error;
  }
}

function normalizeRatio(value?: number | null) {
  return typeof value === "number" ? value : null;
}

function normalizeJsonInput(value: unknown) {
  return value === undefined
    ? Prisma.JsonNull
    : (value as Prisma.InputJsonValue);
}

function serializeTrafficStat(stat?: {
  statDate: Date;
  domainReputation: string | null;
  userReportedSpamRatio: number | null;
  userReportedSpamRatioLowerBound: number | null;
  userReportedSpamRatioUpperBound: number | null;
  spfSuccessRatio: number | null;
  dkimSuccessRatio: number | null;
  dmarcSuccessRatio: number | null;
  outboundEncryptionRatio: number | null;
  inboundEncryptionRatio: number | null;
  deliveryErrors: unknown;
  ipReputations: unknown;
  spammyFeedbackLoops: unknown;
}) {
  if (!stat) {
    return null;
  }

  return {
    statDate: stat.statDate.toISOString(),
    domainReputation: stat.domainReputation,
    userReportedSpamRatio: normalizeRatio(stat.userReportedSpamRatio),
    userReportedSpamRatioLowerBound: normalizeRatio(
      stat.userReportedSpamRatioLowerBound
    ),
    userReportedSpamRatioUpperBound: normalizeRatio(
      stat.userReportedSpamRatioUpperBound
    ),
    spfSuccessRatio: normalizeRatio(stat.spfSuccessRatio),
    dkimSuccessRatio: normalizeRatio(stat.dkimSuccessRatio),
    dmarcSuccessRatio: normalizeRatio(stat.dmarcSuccessRatio),
    outboundEncryptionRatio: normalizeRatio(stat.outboundEncryptionRatio),
    inboundEncryptionRatio: normalizeRatio(stat.inboundEncryptionRatio),
    deliveryErrors: stat.deliveryErrors,
    ipReputations: stat.ipReputations,
    spammyFeedbackLoops: stat.spammyFeedbackLoops,
  };
}

export async function getGooglePostmasterOverview(options: {
  userId: string;
  days?: number;
}) {
  const { userId, days = 30 } = options;
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - days);

  const [localDomains, account] = await Promise.all([
    prisma.domain.findMany({
      where: { userId },
      select: { id: true, domainName: true },
      orderBy: { domainName: "asc" },
    }),
    prisma.googlePostmasterAccount.findUnique({
      where: { userId },
      select: {
        id: true,
        googleEmail: true,
        scope: true,
        createdAt: true,
        lastSyncedAt: true,
        lastSyncError: true,
        domains: {
          orderBy: { domainName: "asc" },
          select: {
            id: true,
            domainName: true,
            permission: true,
            lastSyncedAt: true,
            lastSyncError: true,
            trafficStats: {
              where: { statDate: { gte: since } },
              orderBy: { statDate: "desc" },
              take: 1,
              select: {
                statDate: true,
                domainReputation: true,
                userReportedSpamRatio: true,
                userReportedSpamRatioLowerBound: true,
                userReportedSpamRatioUpperBound: true,
                spfSuccessRatio: true,
                dkimSuccessRatio: true,
                dmarcSuccessRatio: true,
                outboundEncryptionRatio: true,
                inboundEncryptionRatio: true,
                deliveryErrors: true,
                ipReputations: true,
                spammyFeedbackLoops: true,
              },
            },
          },
        },
      },
    }),
  ]);

  const postmasterDomains = (account?.domains || []).map((domain) => ({
    id: domain.id,
    domainName: domain.domainName,
    permission: domain.permission,
    lastSyncedAt: domain.lastSyncedAt?.toISOString() || null,
    lastSyncError: domain.lastSyncError,
    latestStat: serializeTrafficStat(domain.trafficStats[0]),
  }));

  const postmasterByName = new Map(
    postmasterDomains.map((domain) => [domain.domainName, domain])
  );
  const localDomainNames = new Set(localDomains.map((domain) => domain.domainName));

  const localDomainCoverage = localDomains.map((domain) => {
    const postmasterDomain = postmasterByName.get(domain.domainName) || null;
    return {
      id: domain.id,
      domainName: domain.domainName,
      connectedToPostmaster: Boolean(postmasterDomain),
      postmasterPermission: postmasterDomain?.permission || null,
      postmasterLatestStat: postmasterDomain?.latestStat || null,
      postmasterLastSyncError: postmasterDomain?.lastSyncError || null,
      postmasterLastSyncedAt: postmasterDomain?.lastSyncedAt || null,
    };
  });

  const extraPostmasterDomains = postmasterDomains.filter(
    (domain) => !localDomainNames.has(domain.domainName)
  );

  return {
    configured: isGooglePostmasterConfigured(),
    connected: Boolean(account),
    connection: account
      ? {
          googleEmail: account.googleEmail,
          scope: account.scope,
          connectedAt: account.createdAt.toISOString(),
          lastSyncedAt: account.lastSyncedAt?.toISOString() || null,
          lastSyncError: account.lastSyncError,
        }
      : null,
    localDomainCoverage,
    extraPostmasterDomains,
    postmasterDomainCount: postmasterDomains.length,
    domainsWithRecentStats: postmasterDomains.filter((domain) => Boolean(domain.latestStat)).length,
    windowDays: days,
    help: {
      postmasterUrl: "https://postmaster.google.com/",
      apiDocsUrl: "https://developers.google.com/workspace/gmail/postmaster",
      limitation:
        "Google Postmaster covers aggregated traffic sent to personal Gmail accounts and can omit data when volume is low.",
    },
  };
}
