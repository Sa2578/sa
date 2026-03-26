"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { Card, StatsCard } from "@/components/ui/card";
import { Table } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { format } from "date-fns";

interface Lead {
  id: string;
  email: string;
  name: string | null;
  company: string | null;
  status: string;
}

interface EmailLogEntry {
  id: string;
  subject: string;
  status: string;
  sentAt: string | null;
  lead: { email: string; name: string | null };
  inbox: { emailAddress: string };
}

interface CampaignDetail {
  id: string;
  name: string;
  subject: string;
  bodyTemplate: string;
  status: string;
  leads: Lead[];
  _count: { emailLogs: number };
}

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [logs, setLogs] = useState<EmailLogEntry[]>([]);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [starting, setStarting] = useState(false);

  const fetchData = useCallback(async () => {
    const [campRes, logsRes] = await Promise.all([
      fetch(`/api/campaigns/${id}`),
      fetch(`/api/campaigns/${id}/logs`),
    ]);
    if (campRes.ok) setCampaign(await campRes.json());
    if (logsRes.ok) setLogs(await logsRes.json());
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function handleStart() {
    setStarting(true);
    const res = await fetch(`/api/campaigns/${id}/start`, { method: "POST" });
    if (res.ok) fetchData();
    setStarting(false);
  }

  async function handleImport() {
    if (!csvFile) return;
    setImporting(true);
    const formData = new FormData();
    formData.append("file", csvFile);
    formData.append("campaignId", id);
    await fetch("/api/leads/import", { method: "POST", body: formData });
    setCsvFile(null);
    fetchData();
    setImporting(false);
  }

  if (!campaign) return <div className="text-gray-500">Loading...</div>;

  const leadColumns = [
    { key: "email", header: "Email" },
    { key: "name", header: "Name", render: (l: Lead) => l.name || "-" },
    { key: "company", header: "Company", render: (l: Lead) => l.company || "-" },
    { key: "status", header: "Status", render: (l: Lead) => <StatusBadge status={l.status} /> },
  ];

  const logColumns = [
    { key: "lead", header: "To", render: (l: EmailLogEntry) => l.lead.email },
    { key: "inbox", header: "From", render: (l: EmailLogEntry) => l.inbox.emailAddress },
    { key: "status", header: "Status", render: (l: EmailLogEntry) => <StatusBadge status={l.status} /> },
    {
      key: "sentAt",
      header: "Sent",
      render: (l: EmailLogEntry) => l.sentAt ? format(new Date(l.sentAt), "MMM d, HH:mm") : "-",
    },
  ];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{campaign.name}</h1>
          <p className="text-sm text-gray-500">Subject: {campaign.subject}</p>
        </div>
        <div className="flex gap-3">
          {campaign.status === "DRAFT" && (
            <Button onClick={handleStart} disabled={starting || campaign.leads.length === 0}>
              {starting ? "Starting..." : "Start Campaign"}
            </Button>
          )}
          <StatusBadge status={campaign.status} />
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 sm:grid-cols-3">
        <StatsCard title="Leads" value={campaign.leads.length} />
        <StatsCard title="Emails Sent" value={campaign._count.emailLogs} />
        <StatsCard title="Status" value={campaign.status} />
      </div>

      <Card className="mb-6">
        <h2 className="mb-3 text-lg font-semibold">Import More Leads</h2>
        <div className="flex items-center gap-4">
          <input
            type="file"
            accept=".csv"
            onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
            className="text-sm text-gray-500 file:mr-4 file:rounded-lg file:border-0 file:bg-blue-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-blue-700"
          />
          <Button size="sm" onClick={handleImport} disabled={!csvFile || importing}>
            {importing ? "Importing..." : "Import"}
          </Button>
        </div>
      </Card>

      <h2 className="mb-4 text-lg font-semibold">Leads ({campaign.leads.length})</h2>
      <div className="mb-6">
        <Table columns={leadColumns} data={campaign.leads} emptyMessage="No leads yet." />
      </div>

      <h2 className="mb-4 text-lg font-semibold">Email Logs ({logs.length})</h2>
      <Table columns={logColumns} data={logs} emptyMessage="No emails sent yet." />
    </div>
  );
}
