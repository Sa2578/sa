"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { format } from "date-fns";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Card, StatsCard } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface InboxDetail {
  id: string;
  emailAddress: string;
  senderName: string | null;
  replyToEmail: string | null;
  smtpHost: string;
  smtpPort: number;
  dailyLimit: number;
  sentToday: number;
  warmupStatus: string;
  reputationScore: number;
  isActive: boolean;
  lastSmtpVerifiedAt: string | null;
  smtpLastError: string | null;
  domain: { id: string; domainName: string };
}

interface InboxLogEvent {
  id: string;
  eventType: string;
  source: string;
  occurredAt: string | null;
  receivedAt: string;
  payload?: {
    kind?: string;
    placement?: string | null;
    analysis?: HeaderAnalysis;
  } | null;
}

interface InboxLog {
  id: string;
  subject: string;
  status: string;
  messageId: string | null;
  providerMessageId: string | null;
  smtpResponse: string | null;
  failureReason: string | null;
  latestEventType: string | null;
  sentAt: string | null;
  lastEventAt: string | null;
  lead: { email: string; name: string | null; status: string };
  campaign: { id: string; name: string; isSystem: boolean };
  events: InboxLogEvent[];
}

interface HealthPayload {
  appUrl: {
    url: string;
    isHttps: boolean;
    isPublic: boolean;
    hostname: string;
  };
}

interface HeaderAnalysis {
  from: string | null;
  returnPath: string | null;
  deliveredTo: string | null;
  subject: string | null;
  messageId: string | null;
  receivedSpf: string | null;
  authenticationResults: {
    spf: string | null;
    dkim: string | null;
    dmarc: string | null;
  };
  rawAuthenticationResults: string[];
}

function getEventColor(eventType?: string | null) {
  switch (eventType) {
    case "accepted":
      return "blue";
    case "header_analysis":
      return "blue";
    case "delivered":
      return "green";
    case "open":
      return "green";
    case "open_proxy":
      return "yellow";
    case "open_suspected":
      return "yellow";
    case "click":
      return "purple";
    case "bounce":
      return "red";
    case "spam":
      return "red";
    case "reply":
      return "green";
    case "failed":
      return "red";
    default:
      return "gray";
  }
}

function formatEventLabel(eventType?: string | null) {
  if (!eventType) return "none";
  return eventType.replace(/_/g, " ");
}

function getAuthColor(value: string | null) {
  if (value === "pass") return "green";
  if (!value) return "gray";
  return "red";
}

function getPlacementColor(value?: string | null) {
  switch (value) {
    case "INBOX":
      return "green";
    case "PROMOTIONS":
    case "UPDATES":
    case "FORUMS":
      return "yellow";
    case "SPAM":
      return "red";
    case "OTHER":
      return "blue";
    default:
      return "gray";
  }
}

function formatPlacementLabel(value?: string | null) {
  if (!value) return "Unknown";
  return value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, " ");
}

function findHeaderAnalysisEvent(log: InboxLog) {
  return log.events.find(
    (event) =>
      event.eventType === "header_analysis" &&
      event.payload?.kind === "gmail_header_analysis" &&
      event.payload.analysis
  );
}

export default function InboxDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [inbox, setInbox] = useState<InboxDetail | null>(null);
  const [logs, setLogs] = useState<InboxLog[]>([]);
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [editing, setEditing] = useState(false);
  const [dailyLimit, setDailyLimit] = useState(50);
  const [senderName, setSenderName] = useState("");
  const [replyToEmail, setReplyToEmail] = useState("");
  const [verifyingSmtp, setVerifyingSmtp] = useState(false);
  const [smtpMessage, setSmtpMessage] = useState("");
  const [syncingReplies, setSyncingReplies] = useState(false);
  const [replySyncMessage, setReplySyncMessage] = useState("");
  const [testRecipient, setTestRecipient] = useState("");
  const [testSubject, setTestSubject] = useState("");
  const [testBody, setTestBody] = useState("");
  const [sendingTest, setSendingTest] = useState(false);
  const [testMessage, setTestMessage] = useState("");
  const [rawHeaders, setRawHeaders] = useState("");
  const [headerAnalysis, setHeaderAnalysis] = useState<HeaderAnalysis | null>(null);
  const [analyzingHeaders, setAnalyzingHeaders] = useState(false);
  const [headerPlacement, setHeaderPlacement] = useState("UNKNOWN");
  const [headerLogId, setHeaderLogId] = useState("");
  const [headerMessage, setHeaderMessage] = useState("");

  const fetchInbox = useCallback(async () => {
    const [inboxRes, logsRes, healthRes] = await Promise.all([
      fetch(`/api/inboxes/${id}`),
      fetch(`/api/inboxes/${id}/logs?take=25`),
      fetch("/api/health"),
    ]);

    if (inboxRes.ok) {
      const data = await inboxRes.json();
      setInbox(data);
      setDailyLimit(data.dailyLimit);
      setSenderName(data.senderName || "");
      setReplyToEmail(data.replyToEmail || "");
    }

    if (logsRes.ok) {
      const logData = await logsRes.json();
      setLogs(logData);
      if (Array.isArray(logData) && logData.length > 0) {
        setHeaderLogId((current) => current || logData[0].id);
      }
    }

    if (healthRes.ok) {
      setHealth(await healthRes.json());
    }
  }, [id]);

  useEffect(() => {
    fetchInbox();
  }, [fetchInbox]);

  const handleSyncReplies = useCallback(
    async (silent = false) => {
      setSyncingReplies(true);
      if (!silent) {
        setReplySyncMessage("");
      }

      const res = await fetch(`/api/inboxes/${id}/sync-replies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lookbackDays: 21 }),
      });

      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (!silent) {
          setReplySyncMessage(
            `Reply sync complete. ${data.newReplies || 0} new replies linked, ${data.scannedMessages || 0} messages scanned.`
          );
        }
        await fetchInbox();
      } else if (!silent) {
        setReplySyncMessage(data.error || "Unable to sync replies.");
      }

      setSyncingReplies(false);
    },
    [fetchInbox, id]
  );

  useEffect(() => {
    handleSyncReplies(true);
  }, [handleSyncReplies]);

  async function handleUpdate() {
    const res = await fetch(`/api/inboxes/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dailyLimit,
        senderName,
        replyToEmail,
      }),
    });

    if (res.ok) {
      setEditing(false);
      fetchInbox();
    }
  }

  async function handleToggleActive() {
    await fetch(`/api/inboxes/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !inbox?.isActive }),
    });
    fetchInbox();
  }

  async function handleDelete() {
    if (!confirm("Delete this inbox?")) return;
    const res = await fetch(`/api/inboxes/${id}`, { method: "DELETE" });
    if (res.ok) router.push("/inboxes");
  }

  async function handleVerifySmtp() {
    setVerifyingSmtp(true);
    setSmtpMessage("");

    const res = await fetch("/api/inboxes/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inboxId: id }),
    });

    const data = await res.json().catch(() => ({}));
    setSmtpMessage(data.message || data.error || (res.ok ? "SMTP verified." : "SMTP verification failed."));
    setVerifyingSmtp(false);
    fetchInbox();
  }

  async function handleSendTestEmail() {
    setSendingTest(true);
    setTestMessage("");

    const res = await fetch(`/api/inboxes/${id}/send-test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        recipientEmail: testRecipient,
        subject: testSubject || undefined,
        bodyHtml: testBody || undefined,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      const warning = data.tracking?.warning ? ` ${data.tracking.warning}` : "";
      setTestMessage(`Test email sent.${warning}`);
    } else {
      setTestMessage(data.error || "Unable to send test email.");
    }

    setSendingTest(false);
    fetchInbox();
  }

  async function handleAnalyzeHeaders() {
    setAnalyzingHeaders(true);
    setHeaderMessage("");
    const res = await fetch("/api/deliverability/header-analysis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rawHeaders,
        placement: headerPlacement,
        emailLogId: headerLogId || undefined,
      }),
    });

    const data = await res.json().catch(() => null);
    if (res.ok) {
      setHeaderAnalysis(data.analysis || data);
      setHeaderMessage(
        data.persisted
          ? `Header analysis saved to the email log${data.placement && data.placement !== "UNKNOWN" ? ` (${formatPlacementLabel(data.placement)})` : ""}.`
          : "Headers analyzed, but no matching email log was found to persist the result."
      );
      fetchInbox();
    } else {
      setHeaderAnalysis(null);
      setHeaderMessage("Unable to analyze or save these headers.");
    }
    setAnalyzingHeaders(false);
  }

  if (!inbox) return <div className="text-gray-500">Loading...</div>;

  const logColumns = [
    {
      key: "lead",
      header: "Recipient",
      render: (log: InboxLog) => (
        <div>
          <div className="font-medium text-gray-900">{log.lead.email}</div>
          <div className="text-xs text-gray-500">{log.campaign.isSystem ? "System test" : log.campaign.name}</div>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (log: InboxLog) => <StatusBadge status={log.status} />,
    },
    {
      key: "latestEventType",
      header: "Latest Event",
      render: (log: InboxLog) => (
        <Badge color={getEventColor(log.latestEventType)}>
          {log.latestEventType || "none"}
        </Badge>
      ),
    },
    {
      key: "messageId",
      header: "Message ID",
      render: (log: InboxLog) => (
        <span className="font-mono text-xs text-gray-600">{log.messageId || "-"}</span>
      ),
    },
    {
      key: "sentAt",
      header: "Sent",
      render: (log: InboxLog) => log.sentAt ? format(new Date(log.sentAt), "MMM d, HH:mm") : "-",
    },
  ];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{inbox.emailAddress}</h1>
          <p className="text-sm text-gray-500">Domain: {inbox.domain.domainName}</p>
        </div>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={handleToggleActive}>
            {inbox.isActive ? "Deactivate" : "Activate"}
          </Button>
          <Button variant="danger" onClick={handleDelete}>Delete</Button>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard title="Sent Today" value={inbox.sentToday} subtitle={`of ${inbox.dailyLimit} limit`} />
        <StatsCard title="Reputation" value={inbox.reputationScore} trend={inbox.reputationScore >= 80 ? "up" : "down"} />
        <StatsCard title="Warmup" value={inbox.warmupStatus.replace("_", " ")} />
        <StatsCard title="Status" value={inbox.isActive ? "Active" : "Inactive"} />
      </div>

      {health?.appUrl && (!health.appUrl.isPublic || !health.appUrl.isHttps) && (
        <Card className="mb-6 border-yellow-200 bg-yellow-50">
          <h2 className="mb-2 text-lg font-semibold text-yellow-900">Tracking Warning</h2>
          <p className="text-sm text-yellow-800">
            `NEXTAUTH_URL` is currently {health.appUrl.url}. Real open and click tracking need a public HTTPS URL.
          </p>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">SMTP & Sender Identity</h2>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => handleSyncReplies(false)} disabled={syncingReplies}>
                {syncingReplies ? "Syncing Replies..." : "Sync Replies"}
              </Button>
              <Button size="sm" onClick={handleVerifySmtp} disabled={verifyingSmtp}>
                {verifyingSmtp ? "Verifying..." : "Verify SMTP"}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-500">Host:</span>{" "}
              <span className="font-mono">{inbox.smtpHost}</span>
            </div>
            <div>
              <span className="text-gray-500">Port:</span>{" "}
              <span className="font-mono">{inbox.smtpPort}</span>
            </div>
            <div>
              <span className="text-gray-500">Sender name:</span>{" "}
              <span>{inbox.senderName || "-"}</span>
            </div>
            <div>
              <span className="text-gray-500">Reply-To:</span>{" "}
              <span>{inbox.replyToEmail || "-"}</span>
            </div>
          </div>

          {smtpMessage && (
            <p className="mt-4 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">{smtpMessage}</p>
          )}

          {replySyncMessage && (
            <p className="mt-4 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">
              {replySyncMessage}
            </p>
          )}

          {inbox.smtpLastError && (
            <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{inbox.smtpLastError}</p>
          )}

          <p className="mt-4 text-xs text-gray-500">
            Last verified: {inbox.lastSmtpVerifiedAt ? format(new Date(inbox.lastSmtpVerifiedAt), "MMM d, yyyy HH:mm") : "Never"}
          </p>

          <div className="mt-4 border-t pt-4">
            <h3 className="mb-3 text-sm font-medium text-gray-700">Configuration</h3>
            {editing ? (
              <div className="space-y-3">
                <Input type="number" label="Daily Limit" value={String(dailyLimit)} onChange={(e) => setDailyLimit(parseInt(e.target.value, 10) || 0)} />
                <Input label="Sender Name" value={senderName} onChange={(e) => setSenderName(e.target.value)} />
                <Input label="Reply-To" type="email" value={replyToEmail} onChange={(e) => setReplyToEmail(e.target.value)} />
                <div className="flex gap-3">
                  <Button size="sm" onClick={handleUpdate}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <span className="text-lg font-semibold">Daily limit {inbox.dailyLimit}</span>
                <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Button>
              </div>
            )}
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 text-lg font-semibold">Send Real Test Email</h2>
          <div className="space-y-4">
            <Input label="Recipient Email" type="email" value={testRecipient} onChange={(e) => setTestRecipient(e.target.value)} placeholder="your-gmail-test@gmail.com" />
            <Input label="Subject" value={testSubject} onChange={(e) => setTestSubject(e.target.value)} placeholder="[Deliverability Test]" />
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">HTML Body</label>
              <textarea
                value={testBody}
                onChange={(e) => setTestBody(e.target.value)}
                rows={8}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                placeholder="<p>Hello from a real deliverability test.</p>"
              />
            </div>
            <Button onClick={handleSendTestEmail} disabled={sendingTest || !testRecipient}>
              {sendingTest ? "Sending..." : "Send Test"}
            </Button>
            {testMessage && (
              <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">{testMessage}</p>
            )}
          </div>
        </Card>
      </div>

      <Card className="mt-6">
        <h2 className="mb-4 text-lg font-semibold">Analyze Gmail Raw Headers</h2>
        <p className="mb-3 text-sm text-gray-500">
          After receiving the test email in Gmail, open “Show original”, copy the headers and paste them here to inspect SPF, DKIM and DMARC.
        </p>
        <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Match to Email Log</label>
            <select
              value={headerLogId}
              onChange={(e) => setHeaderLogId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="">Auto-match by Message-ID</option>
              {logs.map((log) => (
                <option key={log.id} value={log.id}>
                  {log.lead.email} · {log.subject}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Mailbox Placement</label>
            <select
              value={headerPlacement}
              onChange={(e) => setHeaderPlacement(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="UNKNOWN">Unknown</option>
              <option value="INBOX">Inbox</option>
              <option value="PROMOTIONS">Promotions</option>
              <option value="UPDATES">Updates</option>
              <option value="FORUMS">Forums</option>
              <option value="SPAM">Spam</option>
              <option value="OTHER">Other</option>
            </select>
          </div>
        </div>
        <textarea
          value={rawHeaders}
          onChange={(e) => setRawHeaders(e.target.value)}
          rows={10}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none"
          placeholder="Paste raw headers from Gmail here"
        />
        <div className="mt-4 flex items-center gap-3">
          <Button onClick={handleAnalyzeHeaders} disabled={analyzingHeaders || !rawHeaders.trim()}>
            {analyzingHeaders ? "Analyzing..." : "Analyze Headers"}
          </Button>
        </div>

        {headerMessage && (
          <p className="mt-4 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">{headerMessage}</p>
        )}

        {headerAnalysis && (
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div>
              <h3 className="mb-3 text-sm font-semibold text-gray-700">Authentication Results</h3>
              <div className="flex flex-wrap gap-3">
                <Badge color={getAuthColor(headerAnalysis.authenticationResults.spf)}>SPF: {headerAnalysis.authenticationResults.spf || "unknown"}</Badge>
                <Badge color={getAuthColor(headerAnalysis.authenticationResults.dkim)}>DKIM: {headerAnalysis.authenticationResults.dkim || "unknown"}</Badge>
                <Badge color={getAuthColor(headerAnalysis.authenticationResults.dmarc)}>DMARC: {headerAnalysis.authenticationResults.dmarc || "unknown"}</Badge>
              </div>
              <div className="mt-4 space-y-2 text-sm text-gray-700">
                <p><span className="text-gray-500">From:</span> {headerAnalysis.from || "-"}</p>
                <p><span className="text-gray-500">Return-Path:</span> {headerAnalysis.returnPath || "-"}</p>
                <p><span className="text-gray-500">Delivered-To:</span> {headerAnalysis.deliveredTo || "-"}</p>
                <p><span className="text-gray-500">Message-ID:</span> <span className="font-mono text-xs">{headerAnalysis.messageId || "-"}</span></p>
              </div>
            </div>

            <div>
              <h3 className="mb-3 text-sm font-semibold text-gray-700">Raw Authentication-Results</h3>
              <div className="space-y-2">
                {headerAnalysis.rawAuthenticationResults.map((line) => (
                  <div key={line} className="rounded-lg bg-gray-50 p-3 font-mono text-xs text-gray-700">
                    {line}
                  </div>
                ))}
                {headerAnalysis.rawAuthenticationResults.length === 0 && (
                  <p className="text-sm text-gray-500">No Authentication-Results header found.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </Card>

      <div className="mt-6">
        <h2 className="mb-4 text-lg font-semibold">Recent Delivery Logs ({logs.length})</h2>
        <Table columns={logColumns} data={logs} emptyMessage="No emails sent yet from this inbox." />
      </div>

      {logs.length > 0 && (
        <Card className="mt-6">
          <h2 className="mb-4 text-lg font-semibold">Latest Event Trail</h2>
          <div className="space-y-4">
            {logs.slice(0, 5).map((log) => (
              <div key={log.id} className="rounded-lg border border-gray-200 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="font-medium text-gray-900">{log.lead.email}</div>
                    <div className="text-xs text-gray-500">{log.subject}</div>
                  </div>
                  <StatusBadge status={log.status} />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {log.events.map((event) => (
                    <Badge key={event.id} color={getEventColor(event.eventType)}>
                      {formatEventLabel(event.eventType)} via {event.source}
                    </Badge>
                  ))}
                  {log.events.length === 0 && <Badge color="gray">No events yet</Badge>}
                </div>
                {log.events.some((event) => event.eventType === "open_proxy") && (
                  <p className="mt-3 text-xs text-yellow-700">
                    This message was fetched through a webmail image proxy. It is a likely open, but not counted as a verified open.
                  </p>
                )}
                {log.events.some((event) => event.eventType === "open_suspected") && (
                  <p className="mt-3 text-xs text-yellow-700">
                    A pixel fetch from a proxy or prefetcher was recorded and ignored for open-rate purposes. Gmail webmail image loads are treated as unverified opens.
                  </p>
                )}
                {findHeaderAnalysisEvent(log)?.payload?.analysis && (
                  <div className="mt-3 rounded-lg bg-gray-50 p-3">
                    <div className="mb-2 flex flex-wrap gap-2">
                      <Badge color={getAuthColor(findHeaderAnalysisEvent(log)?.payload?.analysis?.authenticationResults.spf || null)}>
                        SPF: {findHeaderAnalysisEvent(log)?.payload?.analysis?.authenticationResults.spf || "unknown"}
                      </Badge>
                      <Badge color={getAuthColor(findHeaderAnalysisEvent(log)?.payload?.analysis?.authenticationResults.dkim || null)}>
                        DKIM: {findHeaderAnalysisEvent(log)?.payload?.analysis?.authenticationResults.dkim || "unknown"}
                      </Badge>
                      <Badge color={getAuthColor(findHeaderAnalysisEvent(log)?.payload?.analysis?.authenticationResults.dmarc || null)}>
                        DMARC: {findHeaderAnalysisEvent(log)?.payload?.analysis?.authenticationResults.dmarc || "unknown"}
                      </Badge>
                      <Badge color={getPlacementColor(findHeaderAnalysisEvent(log)?.payload?.placement)}>
                        Placement: {formatPlacementLabel(findHeaderAnalysisEvent(log)?.payload?.placement)}
                      </Badge>
                    </div>
                    <p className="text-xs text-gray-600">Saved from Gmail raw headers.</p>
                  </div>
                )}
                {log.smtpResponse && (
                  <p className="mt-3 font-mono text-xs text-gray-600">{log.smtpResponse}</p>
                )}
                {log.failureReason && (
                  <p className="mt-3 text-xs text-red-600">{log.failureReason}</p>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
