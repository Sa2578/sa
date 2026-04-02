"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, StatsCard } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VolumeChart } from "@/components/charts/volume-chart";
import { BounceRateChart } from "@/components/charts/bounce-rate-chart";
import { HealthTrendChart } from "@/components/charts/health-trend-chart";

interface Metrics {
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
  healthScore: number;
}

interface TimeSeriesPoint {
  date: string;
  volume: number;
  bounceRate: number;
  openRate: number;
  verifiedOpenRate: number;
  clickRate: number;
  proxyOpenRate: number;
  spamRate: number;
}

interface DomainMetric {
  id: string;
  domainName: string;
  metrics: Metrics;
}

interface InboxMetric {
  id: string;
  emailAddress: string;
  sendingHost: string;
  sendingHostLabel: string;
  metrics: Metrics;
}

interface CampaignMetric {
  id: string;
  name: string;
  isSystem: boolean;
  metrics: Metrics;
}

interface RecipientProviderMetric {
  provider: string;
  label: string;
  metrics: Metrics;
}

interface SendingHostMetric {
  host: string;
  label: string;
  inboxCount: number;
  domainCount: number;
  metrics: Metrics;
}

interface CohortMetric {
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

interface Alert {
  id: string;
  type: string;
  severity: string;
  message: string;
  createdAt: string;
}

interface MonitoringMailbox {
  id: string;
  emailAddress: string;
  provider: string;
  usage: "PLACEMENT" | "FEEDBACK_LOOP" | "BOTH";
  imapHost: string | null;
  imapPort: number;
  imapSecure: boolean;
  inboxFolderHint: string | null;
  spamFolderHint: string | null;
  notes: string | null;
  isActive: boolean;
  lastCheckedAt: string | null;
  lastCheckError: string | null;
  createdAt: string;
  updatedAt: string;
}

interface PostmasterTrafficStat {
  statDate: string;
  domainReputation: string | null;
  userReportedSpamRatio: number | null;
  userReportedSpamRatioLowerBound: number | null;
  userReportedSpamRatioUpperBound: number | null;
  spfSuccessRatio: number | null;
  dkimSuccessRatio: number | null;
  dmarcSuccessRatio: number | null;
  outboundEncryptionRatio: number | null;
  inboundEncryptionRatio: number | null;
  deliveryErrors: Array<{
    errorClass?: string;
    errorType?: string;
    errorRatio?: number;
  }> | null;
  ipReputations: Array<{
    reputation?: string;
    ipCount?: string;
    sampleIps?: string[];
  }> | null;
  spammyFeedbackLoops: Array<{
    id?: string;
    spamRatio?: number;
  }> | null;
}

interface PostmasterConnection {
  googleEmail: string | null;
  scope: string | null;
  connectedAt: string;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
}

interface LocalDomainPostmasterCoverage {
  id: string;
  domainName: string;
  connectedToPostmaster: boolean;
  postmasterPermission: string | null;
  postmasterLatestStat: PostmasterTrafficStat | null;
  postmasterLastSyncError: string | null;
  postmasterLastSyncedAt: string | null;
}

interface ExtraPostmasterDomain {
  id: string;
  domainName: string;
  permission: string;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  latestStat: PostmasterTrafficStat | null;
}

interface PostmasterOverview {
  configured: boolean;
  connected: boolean;
  connection: PostmasterConnection | null;
  localDomainCoverage: LocalDomainPostmasterCoverage[];
  extraPostmasterDomains: ExtraPostmasterDomain[];
  postmasterDomainCount: number;
  domainsWithRecentStats: number;
  windowDays: number;
  help: {
    postmasterUrl: string;
    apiDocsUrl: string;
    limitation: string;
  };
}

function formatRatioPercent(value?: number | null) {
  if (typeof value !== "number") return "No data";
  return `${Math.round(value * 10000) / 100}%`;
}

function formatReputation(value?: string | null) {
  if (!value || value === "REPUTATION_CATEGORY_UNSPECIFIED") return "No data";
  return value.charAt(0) + value.slice(1).toLowerCase();
}

function formatPlacementCell(rate: number, sampleSize: number) {
  if (!sampleSize) return "No sample";
  return `${rate}%`;
}

function formatMailboxUsage(value: MonitoringMailbox["usage"]) {
  switch (value) {
    case "PLACEMENT":
      return "Placement";
    case "FEEDBACK_LOOP":
      return "Feedback Loop";
    case "BOTH":
      return "Placement + FBL";
    default:
      return value;
  }
}

export default function DeliverabilityPage() {
  const [days, setDays] = useState("30");
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [timeSeries, setTimeSeries] = useState<TimeSeriesPoint[]>([]);
  const [domainMetrics, setDomainMetrics] = useState<DomainMetric[]>([]);
  const [inboxMetrics, setInboxMetrics] = useState<InboxMetric[]>([]);
  const [campaignMetrics, setCampaignMetrics] = useState<CampaignMetric[]>([]);
  const [recipientProviderMetrics, setRecipientProviderMetrics] = useState<RecipientProviderMetric[]>([]);
  const [sendingHostMetrics, setSendingHostMetrics] = useState<SendingHostMetric[]>([]);
  const [cohortMetrics, setCohortMetrics] = useState<CohortMetric[]>([]);
  const [monitoringMailboxes, setMonitoringMailboxes] = useState<MonitoringMailbox[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [postmaster, setPostmaster] = useState<PostmasterOverview | null>(null);
  const [syncingPostmaster, setSyncingPostmaster] = useState(false);
  const [postmasterMessage, setPostmasterMessage] = useState("");
  const [monitoringBusy, setMonitoringBusy] = useState(false);
  const [monitoringMessage, setMonitoringMessage] = useState("");
  const [monitoringForm, setMonitoringForm] = useState({
    emailAddress: "",
    provider: "gmail",
    usage: "PLACEMENT",
    imapHost: "",
    imapPort: "993",
    imapUser: "",
    imapPass: "",
    inboxFolderHint: "",
    spamFolderHint: "",
    notes: "",
  });

  const fetchData = useCallback(async () => {
    await fetch("/api/deliverability/alerts", { method: "POST" });

    const [metRes, alertRes, postmasterRes, monitoringRes] = await Promise.all([
      fetch(`/api/deliverability?days=${days}`),
      fetch("/api/deliverability/alerts"),
      fetch(`/api/deliverability/postmaster?days=${days}`),
      fetch("/api/monitoring-mailboxes"),
    ]);

    if (metRes.ok) {
      const data = await metRes.json();
      setMetrics(data.metrics);
      setTimeSeries(data.timeSeries);
      setDomainMetrics(data.domainMetrics);
      setInboxMetrics(data.inboxMetrics);
      setCampaignMetrics(data.campaignMetrics);
      setRecipientProviderMetrics(data.recipientProviderMetrics || []);
      setSendingHostMetrics(data.sendingHostMetrics || []);
      setCohortMetrics(data.cohortMetrics || []);
    }
    if (alertRes.ok) setAlerts(await alertRes.json());
    if (postmasterRes.ok) setPostmaster(await postmasterRes.json());
    if (monitoringRes.ok) setMonitoringMailboxes(await monitoringRes.json());
  }, [days]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const postmasterError = params.get("postmaster_error");
    const postmasterState = params.get("postmaster");

    if (postmasterError) {
      setPostmasterMessage(postmasterError);
    } else if (postmasterState === "missing-config") {
      setPostmasterMessage(
        "Google Postmaster OAuth is not configured yet. Set GOOGLE_POSTMASTER_CLIENT_ID and GOOGLE_POSTMASTER_CLIENT_SECRET."
      );
    }

    if (postmasterError || postmasterState) {
      params.delete("postmaster_error");
      params.delete("postmaster");
      const nextQuery = params.toString();
      window.history.replaceState(
        {},
        "",
        `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}`
      );
    }
  }, []);

  async function handlePostmasterSync() {
    setSyncingPostmaster(true);
    setPostmasterMessage("");

    const res = await fetch("/api/deliverability/postmaster/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days: parseInt(days, 10) || 30 }),
    });

    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setPostmasterMessage(
        `Google Postmaster sync complete. ${data.domainsSynced || 0} domains updated and ${data.statsUpserted || 0} stat snapshots upserted.`
      );
      await fetchData();
    } else {
      setPostmasterMessage(data.error || "Unable to sync Google Postmaster data.");
    }

    setSyncingPostmaster(false);
  }

  async function handleCreateMonitoringMailbox() {
    setMonitoringBusy(true);
    setMonitoringMessage("");

    const res = await fetch("/api/monitoring-mailboxes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...monitoringForm,
        imapHost: monitoringForm.imapHost || undefined,
        imapPort: monitoringForm.imapPort || undefined,
        inboxFolderHint: monitoringForm.inboxFolderHint || undefined,
        spamFolderHint: monitoringForm.spamFolderHint || undefined,
        notes: monitoringForm.notes || undefined,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setMonitoringMessage("Monitoring mailbox saved.");
      setMonitoringForm({
        emailAddress: "",
        provider: "gmail",
        usage: "PLACEMENT",
        imapHost: "",
        imapPort: "993",
        imapUser: "",
        imapPass: "",
        inboxFolderHint: "",
        spamFolderHint: "",
        notes: "",
      });
      await fetchData();
    } else {
      setMonitoringMessage(
        typeof data?.error === "string"
          ? data.error
          : "Unable to save monitoring mailbox."
      );
    }

    setMonitoringBusy(false);
  }

  async function handleDeleteMonitoringMailbox(id: string) {
    setMonitoringBusy(true);
    setMonitoringMessage("");

    const res = await fetch(`/api/monitoring-mailboxes/${id}`, {
      method: "DELETE",
    });

    if (res.ok) {
      setMonitoringMessage("Monitoring mailbox removed.");
      await fetchData();
    } else {
      const data = await res.json().catch(() => ({}));
      setMonitoringMessage(data.error || "Unable to remove monitoring mailbox.");
    }

    setMonitoringBusy(false);
  }

  if (!metrics) return <div className="text-gray-500">Loading...</div>;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Deliverability</h1>
        <Select
          value={days}
          onChange={(e) => setDays(e.target.value)}
          options={[
            { value: "7", label: "Last 7 days" },
            { value: "30", label: "Last 30 days" },
            { value: "90", label: "Last 90 days" },
          ]}
        />
      </div>

      {alerts.length > 0 && (
        <Card className="mb-6 border-red-200 bg-red-50">
          <h2 className="mb-3 text-lg font-semibold text-red-800">Active Alerts</h2>
          <div className="space-y-2">
            {alerts.map((alert) => (
              <div key={alert.id} className="flex items-center gap-3">
                <Badge color={alert.severity === "critical" ? "red" : "yellow"}>
                  {alert.severity}
                </Badge>
                <span className="text-sm text-red-700">{alert.message}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="mb-6 border-yellow-200 bg-yellow-50">
        <h2 className="mb-2 text-lg font-semibold text-yellow-900">Open Tracking Note</h2>
        <p className="text-sm text-yellow-800">
          Webmail clients like Gmail, Yahoo, and Outlook often fetch images through a proxy, so pixel opens are not a reliable source of truth.
          Use click and reply rates as the primary engagement signals.
        </p>
        <p className="mt-2 text-sm text-yellow-800">
          Current period proxy fetch rate: <strong>{metrics.proxyOpenRate}%</strong>. Verified opens are <strong>{metrics.verifiedOpenRate}%</strong>.
        </p>
        <p className="mt-2 text-sm text-yellow-800">
          Placement coverage is <strong>{metrics.placementCoverageRate}%</strong> across <strong>{metrics.placementSampleSize}</strong> sampled messages from mailbox checks, raw-header analysis, or manual placement observations.
        </p>
      </Card>

      <Card className="mb-6 border-blue-200 bg-blue-50">
        <h2 className="mb-2 text-lg font-semibold text-blue-900">Signal Model</h2>
        <p className="text-sm text-blue-800">
          Recipient provider is inferred from the lead email domain, while sending host is inferred from each inbox SMTP host. This lets us compare Gmail, Yahoo, Outlook, and custom recipients against Google Workspace, Microsoft 365, SES, custom SMTP, and other sending stacks.
        </p>
        <p className="mt-2 text-sm text-blue-800">
          Gmail Postmaster adds provider-side telemetry only for Gmail traffic. Folder placement still depends on sampled mailbox observations, IMAP-accessible monitoring inboxes, or manual placement saves.
        </p>
      </Card>

      <Card className="mb-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Monitoring Mailboxes</h2>
            <p className="mt-1 text-sm text-gray-600">
              Register seed inboxes or provider feedback-loop mailboxes here. Placement checks can then read Gmail, Yahoo, Outlook, or custom mailboxes without turning them into sending inboxes.
            </p>
          </div>
          <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
            Active: <strong>{monitoringMailboxes.filter((item) => item.isActive).length}</strong>
          </div>
        </div>

        {monitoringMessage && (
          <p className="mt-4 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">
            {monitoringMessage}
          </p>
        )}

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-4">
          <Input
            label="Mailbox Email"
            type="email"
            value={monitoringForm.emailAddress}
            onChange={(e) =>
              setMonitoringForm((current) => ({ ...current, emailAddress: e.target.value }))
            }
            placeholder="seed@yahoo.com"
          />
          <Select
            label="Provider"
            value={monitoringForm.provider}
            onChange={(e) =>
              setMonitoringForm((current) => ({ ...current, provider: e.target.value }))
            }
            options={[
              { value: "gmail", label: "Gmail" },
              { value: "yahoo", label: "Yahoo" },
              { value: "outlook", label: "Outlook" },
              { value: "icloud", label: "iCloud" },
              { value: "zoho", label: "Zoho" },
              { value: "custom", label: "Custom IMAP" },
            ]}
          />
          <Select
            label="Usage"
            value={monitoringForm.usage}
            onChange={(e) =>
              setMonitoringForm((current) => ({ ...current, usage: e.target.value }))
            }
            options={[
              { value: "PLACEMENT", label: "Placement" },
              { value: "FEEDBACK_LOOP", label: "Feedback Loop" },
              { value: "BOTH", label: "Placement + FBL" },
            ]}
          />
          <Input
            label="IMAP Host"
            value={monitoringForm.imapHost}
            onChange={(e) =>
              setMonitoringForm((current) => ({ ...current, imapHost: e.target.value }))
            }
            placeholder="Optional for standard providers"
          />
          <Input
            label="IMAP Port"
            type="number"
            value={monitoringForm.imapPort}
            onChange={(e) =>
              setMonitoringForm((current) => ({ ...current, imapPort: e.target.value }))
            }
          />
          <Input
            label="IMAP Username"
            value={monitoringForm.imapUser}
            onChange={(e) =>
              setMonitoringForm((current) => ({ ...current, imapUser: e.target.value }))
            }
            placeholder="Usually the email address"
          />
          <Input
            label="IMAP Password"
            type="password"
            value={monitoringForm.imapPass}
            onChange={(e) =>
              setMonitoringForm((current) => ({ ...current, imapPass: e.target.value }))
            }
          />
          <Input
            label="Inbox Folder Hint"
            value={monitoringForm.inboxFolderHint}
            onChange={(e) =>
              setMonitoringForm((current) => ({ ...current, inboxFolderHint: e.target.value }))
            }
            placeholder="Optional"
          />
          <Input
            label="Spam Folder Hint"
            value={monitoringForm.spamFolderHint}
            onChange={(e) =>
              setMonitoringForm((current) => ({ ...current, spamFolderHint: e.target.value }))
            }
            placeholder="Spam, Bulk Mail, Junk..."
          />
          <div className="xl:col-span-3">
            <label className="mb-1 block text-sm font-medium text-gray-700">Notes</label>
            <textarea
              value={monitoringForm.notes}
              onChange={(e) =>
                setMonitoringForm((current) => ({ ...current, notes: e.target.value }))
              }
              rows={3}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="Example: Yahoo seed inbox for preflight placement or CFL report mailbox."
            />
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-gray-500">
            Use `Placement` for seed inboxes, `Feedback Loop` for Yahoo/Microsoft report mailboxes, or `Both` when one mailbox serves both jobs.
          </p>
          <Button
            onClick={handleCreateMonitoringMailbox}
            disabled={
              monitoringBusy ||
              !monitoringForm.emailAddress ||
              !monitoringForm.imapUser ||
              !monitoringForm.imapPass
            }
          >
            {monitoringBusy ? "Saving..." : "Add Monitoring Mailbox"}
          </Button>
        </div>

        <div className="mt-6">
          <Table
            data={monitoringMailboxes}
            rowKey="id"
            emptyMessage="No monitoring mailboxes yet"
            columns={[
              {
                key: "emailAddress",
                header: "Mailbox",
                render: (item) => (
                    <div>
                      <div>{item.emailAddress}</div>
                      <div className="text-xs text-gray-500">
                      {item.provider} {item.imapHost ? ` | ${item.imapHost}:${item.imapPort}` : ""}
                      </div>
                    </div>
                ),
              },
              {
                key: "usage",
                header: "Usage",
                render: (item) => formatMailboxUsage(item.usage),
              },
              {
                key: "isActive",
                header: "Status",
                render: (item) =>
                  item.isActive ? <Badge color="green">active</Badge> : <Badge color="gray">inactive</Badge>,
              },
              {
                key: "notes",
                header: "Notes",
                render: (item) => item.notes || "-",
              },
              {
                key: "lastCheckError",
                header: "Last Check",
                render: (item) =>
                  item.lastCheckError
                    ? item.lastCheckError
                    : item.lastCheckedAt
                      ? new Date(item.lastCheckedAt).toLocaleString()
                      : "Never",
              },
              {
                key: "actions",
                header: "Actions",
                render: (item) => (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleDeleteMonitoringMailbox(item.id);
                    }}
                    disabled={monitoringBusy}
                  >
                    Delete
                  </Button>
                ),
              },
            ]}
          />
        </div>
      </Card>

      <Card className="mb-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Google Postmaster</h2>
            <p className="mt-1 text-sm text-gray-600">
              Gmail-only, domain-level telemetry for traffic sent to personal Gmail inboxes. Data is aggregated and can lag by about 24 hours.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              variant="secondary"
              onClick={() => window.location.assign("/api/deliverability/postmaster/connect")}
              disabled={!postmaster?.configured}
            >
              {postmaster?.connected ? "Reconnect Postmaster" : "Connect Postmaster"}
            </Button>
            <Button
              onClick={handlePostmasterSync}
              disabled={!postmaster?.configured || !postmaster?.connected || syncingPostmaster}
            >
              {syncingPostmaster ? "Syncing..." : "Sync Gmail Data"}
            </Button>
          </div>
        </div>

        {postmasterMessage && (
          <p className="mt-4 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">
            {postmasterMessage}
          </p>
        )}

        {!postmaster?.configured && (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            Configure `GOOGLE_POSTMASTER_CLIENT_ID` and `GOOGLE_POSTMASTER_CLIENT_SECRET` to enable Gmail Postmaster sync.
          </p>
        )}

        {postmaster?.configured && !postmaster.connected && (
          <p className="mt-4 rounded-lg bg-yellow-50 px-3 py-2 text-sm text-yellow-800">
            Connect a Google account that already has access to your verified Postmaster domains. Google Postmaster itself must already contain the domains you want to read.
          </p>
        )}

        {postmaster?.connection && (
          <div className="mt-4 grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <span className="text-gray-500">Connected:</span>{" "}
              <span>{postmaster.connection.googleEmail || "Google account linked"}</span>
            </div>
            <div>
              <span className="text-gray-500">Last sync:</span>{" "}
              <span>
                {postmaster.connection.lastSyncedAt
                  ? new Date(postmaster.connection.lastSyncedAt).toLocaleString()
                  : "Never"}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Postmaster domains:</span>{" "}
              <span>{postmaster.postmasterDomainCount}</span>
            </div>
            <div>
              <span className="text-gray-500">Domains with recent stats:</span>{" "}
              <span>{postmaster.domainsWithRecentStats}</span>
            </div>
          </div>
        )}

        {postmaster?.connection?.lastSyncError && (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {postmaster.connection.lastSyncError}
          </p>
        )}

        {postmaster && (
          <>
            <p className="mt-4 text-sm text-gray-600">
              {postmaster.help.limitation} Campaign emails sent by this app now include a `Feedback-ID` header so Gmail Feedback Loop data can be grouped per campaign.
            </p>

            <div className="mt-6">
              <h3 className="mb-3 text-lg font-semibold text-gray-900">Local Domains vs Gmail Postmaster</h3>
              <Table
                data={postmaster.localDomainCoverage}
                rowKey="id"
                emptyMessage="No local domains available yet."
                columns={[
                  {
                    key: "domainName",
                    header: "Domain",
                  },
                  {
                    key: "connectedToPostmaster",
                    header: "Status",
                    render: (item) =>
                      item.connectedToPostmaster ? (
                        <Badge color="green">{item.postmasterPermission || "connected"}</Badge>
                      ) : (
                        <Badge color="gray">Not in Postmaster</Badge>
                      ),
                  },
                  {
                    key: "statDate",
                    header: "Latest Gmail Day",
                    render: (item) =>
                      item.postmasterLatestStat?.statDate
                        ? new Date(item.postmasterLatestStat.statDate).toLocaleDateString()
                        : "No data",
                  },
                  {
                    key: "spamRate",
                    header: "Gmail Spam",
                    render: (item) =>
                      formatRatioPercent(item.postmasterLatestStat?.userReportedSpamRatio),
                  },
                  {
                    key: "domainReputation",
                    header: "Reputation",
                    render: (item) =>
                      formatReputation(item.postmasterLatestStat?.domainReputation),
                  },
                  {
                    key: "auth",
                    header: "Auth",
                    render: (item) =>
                      item.postmasterLatestStat
                        ? `DKIM ${formatRatioPercent(item.postmasterLatestStat.dkimSuccessRatio)} / SPF ${formatRatioPercent(item.postmasterLatestStat.spfSuccessRatio)} / DMARC ${formatRatioPercent(item.postmasterLatestStat.dmarcSuccessRatio)}`
                        : "No data",
                  },
                ]}
              />
            </div>

            {postmaster.extraPostmasterDomains.length > 0 && (
              <div className="mt-4 rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-700">
                Extra Postmaster domains not present in this app:{" "}
                {postmaster.extraPostmasterDomains.map((domain) => domain.domainName).join(", ")}
              </div>
            )}

            <div className="mt-4 text-sm text-gray-600">
              <a className="text-blue-600 hover:underline" href={postmaster.help.postmasterUrl} target="_blank" rel="noreferrer">
                Open Google Postmaster Tools
              </a>{" "}
              <span className="text-gray-400">|</span>{" "}
              <a className="text-blue-600 hover:underline" href={postmaster.help.apiDocsUrl} target="_blank" rel="noreferrer">
                API docs
              </a>
            </div>
          </>
        )}
      </Card>

      <div className="mb-8 grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <StatsCard
          title="Health Score"
          value={`${metrics.healthScore}%`}
          trend={metrics.healthScore >= 80 ? "up" : metrics.healthScore >= 50 ? "neutral" : "down"}
        />
        <StatsCard title="Emails Sent" value={metrics.totalSent} />
        <StatsCard
          title="Bounce Rate"
          value={`${metrics.bounceRate}%`}
          trend={metrics.bounceRate < 5 ? "up" : "down"}
        />
        <StatsCard
          title="Click Rate"
          value={`${metrics.clickRate}%`}
          trend={metrics.clickRate > 5 ? "up" : metrics.clickRate > 1 ? "neutral" : "down"}
        />
        <StatsCard
          title="Reply Rate"
          value={`${metrics.replyRate}%`}
          trend={metrics.replyRate > 3 ? "up" : metrics.replyRate > 0 ? "neutral" : "down"}
        />
        <StatsCard
          title="Spam Rate"
          value={`${metrics.spamRate}%`}
          trend={metrics.spamRate < 1 ? "up" : "down"}
        />
        <StatsCard
          title="Inbox Placement"
          value={`${metrics.inboxPlacementRate}%`}
          subtitle="Among sampled messages"
          trend={metrics.inboxPlacementRate >= 80 ? "up" : metrics.inboxPlacementRate >= 50 ? "neutral" : "down"}
        />
        <StatsCard
          title="Placement Coverage"
          value={`${metrics.placementCoverageRate}%`}
          subtitle={`${metrics.placementSampleSize} samples`}
          trend={metrics.placementCoverageRate >= 20 ? "up" : "neutral"}
        />
      </div>

      <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <h3 className="mb-4 text-lg font-semibold">Sending Volume</h3>
          <VolumeChart data={timeSeries} />
        </Card>
        <Card>
          <h3 className="mb-4 text-lg font-semibold">Rates Over Time</h3>
          <BounceRateChart data={timeSeries} />
        </Card>
      </div>

      {domainMetrics.length > 0 && (
        <Card>
          <h3 className="mb-4 text-lg font-semibold">Health Score by Domain</h3>
          <HealthTrendChart
            data={domainMetrics.map((d) => ({
              name: d.domainName,
              healthScore: d.metrics.healthScore,
            }))}
          />
        </Card>
      )}

      <div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <h3 className="mb-4 text-lg font-semibold">Recipient Provider Breakdown</h3>
          <Table
            data={recipientProviderMetrics
              .filter((item) => item.metrics.totalSent > 0)
              .slice()
              .sort((left, right) => right.metrics.totalSent - left.metrics.totalSent)}
            rowKey="provider"
            emptyMessage="No recipient-provider data yet"
            columns={[
              {
                key: "label",
                header: "Recipient",
              },
              {
                key: "totalSent",
                header: "Sent",
                render: (item) => item.metrics.totalSent,
              },
              {
                key: "bounceRate",
                header: "Bounce",
                render: (item) => `${item.metrics.bounceRate}%`,
              },
              {
                key: "clickRate",
                header: "Click",
                render: (item) => `${item.metrics.clickRate}%`,
              },
              {
                key: "replyRate",
                header: "Reply",
                render: (item) => `${item.metrics.replyRate}%`,
              },
              {
                key: "spamPlacementRate",
                header: "Spam Place.",
                render: (item) =>
                  formatPlacementCell(
                    item.metrics.spamPlacementRate,
                    item.metrics.placementSampleSize
                  ),
              },
              {
                key: "healthScore",
                header: "Health",
                render: (item) => `${item.metrics.healthScore}%`,
              },
            ]}
          />
        </Card>

        <Card>
          <h3 className="mb-4 text-lg font-semibold">Sending Host Breakdown</h3>
          <Table
            data={sendingHostMetrics
              .filter((item) => item.metrics.totalSent > 0)
              .slice()
              .sort((left, right) => right.metrics.totalSent - left.metrics.totalSent)}
            rowKey="host"
            emptyMessage="No sending-host data yet"
            columns={[
              {
                key: "label",
                header: "Host",
              },
              {
                key: "inboxCount",
                header: "Inboxes",
              },
              {
                key: "domainCount",
                header: "Domains",
              },
              {
                key: "totalSent",
                header: "Sent",
                render: (item) => item.metrics.totalSent,
              },
              {
                key: "bounceRate",
                header: "Bounce",
                render: (item) => `${item.metrics.bounceRate}%`,
              },
              {
                key: "clickRate",
                header: "Click",
                render: (item) => `${item.metrics.clickRate}%`,
              },
              {
                key: "replyRate",
                header: "Reply",
                render: (item) => `${item.metrics.replyRate}%`,
              },
              {
                key: "healthScore",
                header: "Health",
                render: (item) => `${item.metrics.healthScore}%`,
              },
            ]}
          />
        </Card>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Card>
          <h3 className="mb-4 text-lg font-semibold">Inbox Breakdown</h3>
          <Table
            data={inboxMetrics
              .filter((item) => item.metrics.totalSent > 0)
              .slice()
              .sort((left, right) => right.metrics.totalSent - left.metrics.totalSent)}
            rowKey="id"
            emptyMessage="No inbox deliverability data yet"
            columns={[
              {
                key: "emailAddress",
                header: "Inbox",
                render: (item) => (
                  <div>
                    <div>{item.emailAddress}</div>
                    <div className="text-xs text-gray-500">{item.sendingHostLabel}</div>
                  </div>
                ),
              },
              {
                key: "healthScore",
                header: "Health",
                render: (item) => `${item.metrics.healthScore}%`,
              },
              {
                key: "bounceRate",
                header: "Bounce",
                render: (item) => `${item.metrics.bounceRate}%`,
              },
              {
                key: "clickRate",
                header: "Click",
                render: (item) => `${item.metrics.clickRate}%`,
              },
              {
                key: "replyRate",
                header: "Reply",
                render: (item) => `${item.metrics.replyRate}%`,
              },
              {
                key: "inboxPlacementRate",
                header: "Inbox Place.",
                render: (item) =>
                  formatPlacementCell(
                    item.metrics.inboxPlacementRate,
                    item.metrics.placementSampleSize
                  ),
              },
            ]}
          />
        </Card>

        <Card>
          <h3 className="mb-4 text-lg font-semibold">Campaign Breakdown</h3>
          <Table
            data={campaignMetrics
              .filter((item) => item.metrics.totalSent > 0)
              .slice()
              .sort((left, right) => right.metrics.totalSent - left.metrics.totalSent)}
            rowKey="id"
            emptyMessage="No campaign deliverability data yet"
            columns={[
              {
                key: "name",
                header: "Campaign",
                render: (item) => (
                  <div className="flex items-center gap-2">
                    <span>{item.name}</span>
                    {item.isSystem && <Badge color="gray">system</Badge>}
                  </div>
                ),
              },
              {
                key: "healthScore",
                header: "Health",
                render: (item) => `${item.metrics.healthScore}%`,
              },
              {
                key: "bounceRate",
                header: "Bounce",
                render: (item) => `${item.metrics.bounceRate}%`,
              },
              {
                key: "clickRate",
                header: "Click",
                render: (item) => `${item.metrics.clickRate}%`,
              },
              {
                key: "replyRate",
                header: "Reply",
                render: (item) => `${item.metrics.replyRate}%`,
              },
              {
                key: "inboxPlacementRate",
                header: "Inbox Place.",
                render: (item) =>
                  formatPlacementCell(
                    item.metrics.inboxPlacementRate,
                    item.metrics.placementSampleSize
                  ),
              },
            ]}
          />
        </Card>
      </div>

      <div className="mt-8">
        <Card>
          <div className="mb-4 flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h3 className="text-lg font-semibold">Daily Cohorts</h3>
              <p className="mt-1 text-sm text-gray-600">
                Each row is a day x campaign x sending domain x inbox x sending host x recipient provider cohort.
              </p>
            </div>
            <p className="text-sm text-gray-500">
              Showing the latest {Math.min(cohortMetrics.length, 60)} of {cohortMetrics.length} rows.
            </p>
          </div>
          <Table
            data={cohortMetrics.slice(0, 60)}
            rowKey="id"
            emptyMessage="No cohort data yet"
            columns={[
              {
                key: "date",
                header: "Date",
              },
              {
                key: "campaignName",
                header: "Campaign",
              },
              {
                key: "senderDomain",
                header: "Sender Domain",
              },
              {
                key: "sendingInbox",
                header: "Inbox",
              },
              {
                key: "sendingHostLabel",
                header: "Host",
              },
              {
                key: "recipientProviderLabel",
                header: "Recipient",
              },
              {
                key: "totalSent",
                header: "Sent",
              },
              {
                key: "bounceRate",
                header: "Bounce",
                render: (item) => `${item.bounceRate}%`,
              },
              {
                key: "clickRate",
                header: "Click",
                render: (item) => `${item.clickRate}%`,
              },
              {
                key: "replyRate",
                header: "Reply",
                render: (item) => `${item.replyRate}%`,
              },
              {
                key: "inboxPlacementRate",
                header: "Inbox Place.",
                render: (item) =>
                  formatPlacementCell(item.inboxPlacementRate, item.placementSampleSize),
              },
              {
                key: "healthScore",
                header: "Health",
                render: (item) => `${item.healthScore}%`,
              },
            ]}
          />
        </Card>
      </div>
    </div>
  );
}
