"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Table } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/badge";
import { format } from "date-fns";

interface Campaign {
  id: string;
  name: string;
  subject: string;
  status: string;
  _count: { leads: number; emailLogs: number };
  createdAt: string;
}

export default function CampaignsPage() {
  const router = useRouter();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);

  const fetchCampaigns = useCallback(async () => {
    const res = await fetch("/api/campaigns");
    if (res.ok) setCampaigns(await res.json());
  }, []);

  useEffect(() => { fetchCampaigns(); }, [fetchCampaigns]);

  const columns = [
    { key: "name", header: "Name" },
    { key: "subject", header: "Subject" },
    {
      key: "status",
      header: "Status",
      render: (c: Campaign) => <StatusBadge status={c.status} />,
    },
    {
      key: "leads",
      header: "Leads",
      render: (c: Campaign) => c._count.leads,
    },
    {
      key: "emails",
      header: "Emails Sent",
      render: (c: Campaign) => c._count.emailLogs,
    },
    {
      key: "createdAt",
      header: "Created",
      render: (c: Campaign) => format(new Date(c.createdAt), "MMM d, yyyy"),
    },
  ];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Campaigns</h1>
        <Button onClick={() => router.push("/campaigns/new")}>Create Campaign</Button>
      </div>

      <Table
        columns={columns}
        data={campaigns}
        onRowClick={(c) => router.push(`/campaigns/${c.id}`)}
        emptyMessage="No campaigns yet. Create your first campaign."
      />
    </div>
  );
}
