"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Table } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/badge";

interface Inbox {
  id: string;
  emailAddress: string;
  dailyLimit: number;
  sentToday: number;
  warmupStatus: string;
  reputationScore: number;
  isActive: boolean;
  domain: { domainName: string };
}

export default function InboxesPage() {
  const router = useRouter();
  const [inboxes, setInboxes] = useState<Inbox[]>([]);

  const fetchInboxes = useCallback(async () => {
    const res = await fetch("/api/inboxes");
    if (res.ok) setInboxes(await res.json());
  }, []);

  useEffect(() => { fetchInboxes(); }, [fetchInboxes]);

  const columns = [
    { key: "emailAddress", header: "Email" },
    {
      key: "domain",
      header: "Domain",
      render: (i: Inbox) => i.domain.domainName,
    },
    {
      key: "usage",
      header: "Daily Usage",
      render: (i: Inbox) => {
        const pct = i.dailyLimit > 0 ? (i.sentToday / i.dailyLimit) * 100 : 0;
        return (
          <div className="flex items-center gap-2">
            <div className="h-2 w-24 rounded-full bg-gray-200">
              <div
                className={`h-2 rounded-full ${pct > 90 ? "bg-red-500" : pct > 70 ? "bg-yellow-500" : "bg-green-500"}`}
                style={{ width: `${Math.min(pct, 100)}%` }}
              />
            </div>
            <span className="text-xs text-gray-500">{i.sentToday}/{i.dailyLimit}</span>
          </div>
        );
      },
    },
    {
      key: "warmupStatus",
      header: "Warmup",
      render: (i: Inbox) => <StatusBadge status={i.warmupStatus} />,
    },
    {
      key: "reputationScore",
      header: "Reputation",
      render: (i: Inbox) => (
        <span className={`font-semibold ${i.reputationScore >= 80 ? "text-green-600" : i.reputationScore >= 50 ? "text-yellow-600" : "text-red-600"}`}>
          {i.reputationScore}
        </span>
      ),
    },
    {
      key: "isActive",
      header: "Status",
      render: (i: Inbox) => (
        <span className={i.isActive ? "text-green-600" : "text-gray-400"}>
          {i.isActive ? "Active" : "Inactive"}
        </span>
      ),
    },
  ];

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-gray-900">All Inboxes</h1>
      <Table
        columns={columns}
        data={inboxes}
        onRowClick={(i) => router.push(`/inboxes/${i.id}`)}
        emptyMessage="No inboxes yet. Add inboxes from a domain page."
      />
    </div>
  );
}
