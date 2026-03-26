"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { format } from "date-fns";
import { Card } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/badge";

interface Inbox {
  id: string;
  emailAddress: string;
  senderName: string | null;
  dailyLimit: number;
  sentToday: number;
  warmupStatus: string;
  reputationScore: number;
  isActive: boolean;
}

interface DkimSelectorResult {
  selector: string;
  valid: boolean;
  recordType: "TXT" | "CNAME" | "NONE";
  records: string[];
  error?: string;
}

interface DnsCheckReport {
  warnings: string[];
  errors: string[];
  dmarcPolicy: string | null;
  rua: string[];
  selectorsChecked: string[];
  dkimResults: DkimSelectorResult[];
  mxRecords: Array<{ exchange: string; priority: number }>;
}

interface Domain {
  id: string;
  domainName: string;
  status: string;
  spfValid: boolean;
  dkimValid: boolean;
  dmarcValid: boolean;
  spfRecord: string | null;
  dmarcRecord: string | null;
  dkimSelectors: string[] | null;
  mxRecords: Array<{ exchange: string; priority: number }> | null;
  dnsLastCheckedAt: string | null;
  dnsLastError: string | null;
  dnsCheckReport: DnsCheckReport | null;
  inboxes: Inbox[];
}

function parseSelectors(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\s,]+/)
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

export default function DomainDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [domain, setDomain] = useState<Domain | null>(null);
  const [showInboxModal, setShowInboxModal] = useState(false);
  const [checkingDns, setCheckingDns] = useState(false);
  const [dnsFeedback, setDnsFeedback] = useState("");
  const [selectorsInput, setSelectorsInput] = useState("");
  const [inboxForm, setInboxForm] = useState({
    emailAddress: "",
    senderName: "",
    replyToEmail: "",
    smtpHost: "",
    smtpPort: 587,
    smtpUser: "",
    smtpPass: "",
    dailyLimit: 50,
  });

  const fetchDomain = useCallback(async () => {
    const res = await fetch(`/api/domains/${id}`);
    if (!res.ok) return;

    const data = await res.json();
    setDomain(data);
    setSelectorsInput(Array.isArray(data.dkimSelectors) ? data.dkimSelectors.join(", ") : "");
  }, [id]);

  useEffect(() => {
    fetchDomain();
  }, [fetchDomain]);

  async function handleAddInbox(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/inboxes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        domainId: id,
        emailAddress: inboxForm.emailAddress,
        senderName: inboxForm.senderName,
        replyToEmail: inboxForm.replyToEmail,
        smtpHost: inboxForm.smtpHost,
        smtpPort: inboxForm.smtpPort,
        smtpUser: inboxForm.smtpUser,
        smtpPass: inboxForm.smtpPass,
        dailyLimit: inboxForm.dailyLimit,
      }),
    });

    if (res.ok) {
      setShowInboxModal(false);
      setInboxForm({
        emailAddress: "",
        senderName: "",
        replyToEmail: "",
        smtpHost: "",
        smtpPort: 587,
        smtpUser: "",
        smtpPass: "",
        dailyLimit: 50,
      });
      fetchDomain();
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this domain and all its inboxes?")) return;
    const res = await fetch(`/api/domains/${id}`, { method: "DELETE" });
    if (res.ok) router.push("/domains");
  }

  async function handleRunDnsCheck() {
    setCheckingDns(true);
    setDnsFeedback("");

    const dkimSelectors = parseSelectors(selectorsInput);

    const saveRes = await fetch(`/api/domains/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dkimSelectors }),
    });

    if (!saveRes.ok) {
      setCheckingDns(false);
      setDnsFeedback("Unable to save DKIM selectors.");
      return;
    }

    const checkRes = await fetch(`/api/domains/${id}/check-dns`, { method: "POST" });
    if (!checkRes.ok) {
      const data = await checkRes.json().catch(() => ({ error: "DNS check failed" }));
      setDnsFeedback(data.error || "DNS check failed");
      setCheckingDns(false);
      return;
    }

    const data = await checkRes.json();
    setDnsFeedback(
      data.result?.warnings?.length
        ? data.result.warnings.join(" ")
        : "DNS check completed successfully."
    );

    await fetchDomain();
    setCheckingDns(false);
  }

  if (!domain) return <div className="text-gray-500">Loading...</div>;

  const inboxColumns = [
    { key: "emailAddress", header: "Email" },
    {
      key: "senderName",
      header: "Sender",
      render: (inbox: Inbox) => inbox.senderName || "-",
    },
    {
      key: "usage",
      header: "Usage",
      render: (inbox: Inbox) => `${inbox.sentToday} / ${inbox.dailyLimit}`,
    },
    {
      key: "warmupStatus",
      header: "Warmup",
      render: (inbox: Inbox) => <StatusBadge status={inbox.warmupStatus} />,
    },
    {
      key: "reputationScore",
      header: "Reputation",
      render: (inbox: Inbox) => (
        <span className={inbox.reputationScore >= 80 ? "text-green-600" : inbox.reputationScore >= 50 ? "text-yellow-600" : "text-red-600"}>
          {inbox.reputationScore}
        </span>
      ),
    },
    {
      key: "isActive",
      header: "Active",
      render: (inbox: Inbox) => (inbox.isActive ? "Yes" : "No"),
    },
  ];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{domain.domainName}</h1>
          <div className="mt-1">
            <StatusBadge status={domain.status} />
          </div>
        </div>
        <div className="flex gap-3">
          <Button onClick={() => setShowInboxModal(true)}>Add Inbox</Button>
          <Button variant="danger" onClick={handleDelete}>Delete Domain</Button>
        </div>
      </div>

      <Card className="mb-6">
        <div className="mb-4 flex items-start justify-between gap-6">
          <div>
            <h2 className="text-lg font-semibold">Live DNS Authentication</h2>
            <p className="mt-1 text-sm text-gray-500">
              Configure the selectors used by your sender, then run a real DNS check against SPF, DKIM, DMARC and MX.
            </p>
          </div>
          <Button onClick={handleRunDnsCheck} disabled={checkingDns}>
            {checkingDns ? "Checking..." : "Run DNS Check"}
          </Button>
        </div>

        <div className="mb-4">
          <Input
            label="DKIM Selectors"
            value={selectorsInput}
            onChange={(e) => setSelectorsInput(e.target.value)}
            placeholder="google, selector1"
          />
          <p className="mt-2 text-xs text-gray-500">
            Separate selectors with commas or spaces. For Google Workspace the common selector is often `google`.
          </p>
        </div>

        {dnsFeedback && (
          <p className="mb-4 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">{dnsFeedback}</p>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className={`rounded-lg p-3 text-center ${domain.spfValid ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
            <div className="text-sm font-medium">SPF</div>
            <div className="text-lg font-bold">{domain.spfValid ? "Valid" : "Missing"}</div>
          </div>
          <div className={`rounded-lg p-3 text-center ${domain.dkimValid ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
            <div className="text-sm font-medium">DKIM</div>
            <div className="text-lg font-bold">{domain.dkimValid ? "Valid" : "Missing"}</div>
          </div>
          <div className={`rounded-lg p-3 text-center ${domain.dmarcValid ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
            <div className="text-sm font-medium">DMARC</div>
            <div className="text-lg font-bold">{domain.dmarcValid ? "Valid" : "Missing"}</div>
          </div>
          <div className={`rounded-lg p-3 text-center ${(domain.mxRecords?.length || 0) > 0 ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
            <div className="text-sm font-medium">MX</div>
            <div className="text-lg font-bold">{(domain.mxRecords?.length || 0) > 0 ? "Present" : "Missing"}</div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-semibold text-gray-700">Raw Records</h3>
            <div className="space-y-3 text-sm">
              <div>
                <div className="text-gray-500">SPF</div>
                <div className="rounded-lg bg-gray-50 p-3 font-mono text-xs text-gray-700">{domain.spfRecord || "Not found"}</div>
              </div>
              <div>
                <div className="text-gray-500">DMARC</div>
                <div className="rounded-lg bg-gray-50 p-3 font-mono text-xs text-gray-700">{domain.dmarcRecord || "Not found"}</div>
              </div>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-gray-700">Check Summary</h3>
            <div className="space-y-3 text-sm text-gray-700">
              <p>
                Last checked:{" "}
                <span className="font-medium">
                  {domain.dnsLastCheckedAt ? format(new Date(domain.dnsLastCheckedAt), "MMM d, yyyy HH:mm") : "Never"}
                </span>
              </p>
              <p>
                DMARC policy:{" "}
                <span className="font-medium">{domain.dnsCheckReport?.dmarcPolicy || "Not found"}</span>
              </p>
              <p>
                RUA reports:{" "}
                <span className="font-medium">
                  {domain.dnsCheckReport?.rua?.length ? domain.dnsCheckReport.rua.join(", ") : "None configured"}
                </span>
              </p>
              {domain.dnsLastError && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-red-700">{domain.dnsLastError}</p>
              )}
              {(domain.dnsCheckReport?.warnings?.length || 0) > 0 && (
                <div className="rounded-lg bg-yellow-50 p-3 text-yellow-800">
                  {domain.dnsCheckReport?.warnings.map((warning) => (
                    <p key={warning}>{warning}</p>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <h3 className="mb-3 text-sm font-semibold text-gray-700">DKIM Results</h3>
            <div className="space-y-3">
              {(domain.dnsCheckReport?.dkimResults || []).map((result) => (
                <div key={result.selector} className="rounded-lg border border-gray-200 p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm text-gray-900">{result.selector}</span>
                    <span className={result.valid ? "text-green-600" : "text-red-600"}>
                      {result.valid ? result.recordType : "Missing"}
                    </span>
                  </div>
                  {result.records.length > 0 && (
                    <div className="mt-2 rounded bg-gray-50 p-2 font-mono text-xs text-gray-700">
                      {result.records.join(" | ")}
                    </div>
                  )}
                  {result.error && <p className="mt-2 text-xs text-red-600">{result.error}</p>}
                </div>
              ))}
              {(domain.dnsCheckReport?.dkimResults || []).length === 0 && (
                <p className="text-sm text-gray-500">Run the DNS check to inspect DKIM selectors.</p>
              )}
            </div>
          </div>

          <div>
            <h3 className="mb-3 text-sm font-semibold text-gray-700">MX Records</h3>
            <div className="space-y-2">
              {(domain.dnsCheckReport?.mxRecords || domain.mxRecords || []).map((record) => (
                <div key={`${record.exchange}-${record.priority}`} className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700">
                  <span className="font-mono">{record.exchange}</span>
                  <span className="ml-2 text-gray-500">priority {record.priority}</span>
                </div>
              ))}
              {(domain.dnsCheckReport?.mxRecords || domain.mxRecords || []).length === 0 && (
                <p className="text-sm text-gray-500">No MX records available yet.</p>
              )}
            </div>
          </div>
        </div>
      </Card>

      <h2 className="mb-4 text-lg font-semibold">Inboxes ({domain.inboxes.length})</h2>
      <Table
        columns={inboxColumns}
        data={domain.inboxes}
        onRowClick={(inbox) => router.push(`/inboxes/${inbox.id}`)}
        emptyMessage="No inboxes yet."
      />

      <Modal open={showInboxModal} onClose={() => setShowInboxModal(false)} title="Add Inbox">
        <form onSubmit={handleAddInbox} className="space-y-4">
          <Input label="Email Address" type="email" value={inboxForm.emailAddress} onChange={(e) => setInboxForm({ ...inboxForm, emailAddress: e.target.value })} required />
          <div className="grid grid-cols-2 gap-4">
            <Input label="Sender Name" value={inboxForm.senderName} onChange={(e) => setInboxForm({ ...inboxForm, senderName: e.target.value })} placeholder="Sales Team" />
            <Input label="Reply-To" type="email" value={inboxForm.replyToEmail} onChange={(e) => setInboxForm({ ...inboxForm, replyToEmail: e.target.value })} placeholder="reply@example.com" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="SMTP Host" value={inboxForm.smtpHost} onChange={(e) => setInboxForm({ ...inboxForm, smtpHost: e.target.value })} required />
            <Input label="SMTP Port" type="number" value={String(inboxForm.smtpPort)} onChange={(e) => setInboxForm({ ...inboxForm, smtpPort: parseInt(e.target.value, 10) || 587 })} required />
          </div>
          <Input label="SMTP User" value={inboxForm.smtpUser} onChange={(e) => setInboxForm({ ...inboxForm, smtpUser: e.target.value })} required />
          <Input label="SMTP Password" type="password" value={inboxForm.smtpPass} onChange={(e) => setInboxForm({ ...inboxForm, smtpPass: e.target.value })} required />
          <Input label="Daily Limit" type="number" value={String(inboxForm.dailyLimit)} onChange={(e) => setInboxForm({ ...inboxForm, dailyLimit: parseInt(e.target.value, 10) || 50 })} />
          <div className="flex justify-end gap-3">
            <Button variant="secondary" type="button" onClick={() => setShowInboxModal(false)}>Cancel</Button>
            <Button type="submit">Create</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
