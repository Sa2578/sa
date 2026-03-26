"use client";

import { useState, useEffect } from "react";
import { StatsCard } from "@/components/ui/card";

interface DashboardData {
  metrics: {
    totalSent: number;
    bounceRate: number;
    openRate: number;
    spamRate: number;
    healthScore: number;
  };
  domainCount: number;
  inboxCount: number;
  campaignCount: number;
  activeCampaigns: number;
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    async function load() {
      const [metRes, domRes, inbRes, campRes] = await Promise.all([
        fetch("/api/deliverability?days=30"),
        fetch("/api/domains"),
        fetch("/api/inboxes"),
        fetch("/api/campaigns"),
      ]);

      const metData = metRes.ok ? await metRes.json() : { metrics: { totalSent: 0, bounceRate: 0, openRate: 0, spamRate: 0, healthScore: 100 } };
      const domains = domRes.ok ? await domRes.json() : [];
      const inboxes = inbRes.ok ? await inbRes.json() : [];
      const campaigns = campRes.ok ? await campRes.json() : [];

      setData({
        metrics: metData.metrics,
        domainCount: domains.length,
        inboxCount: inboxes.length,
        campaignCount: campaigns.length,
        activeCampaigns: campaigns.filter((c: { status: string }) => c.status === "ACTIVE").length,
      });
    }
    load();
  }, []);

  if (!data) return <div className="text-gray-500">Loading dashboard...</div>;

  const { metrics } = data;

  return (
    <div>
      <h1 className="mb-8 text-2xl font-bold text-gray-900">Dashboard</h1>

      <div className="mb-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard title="Domains" value={data.domainCount} />
        <StatsCard title="Inboxes" value={data.inboxCount} />
        <StatsCard title="Campaigns" value={data.campaignCount} subtitle={`${data.activeCampaigns} active`} />
        <StatsCard title="Emails Sent" value={metrics.totalSent} subtitle="Last 30 days" />
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard
          title="Health Score"
          value={`${metrics.healthScore}%`}
          trend={metrics.healthScore >= 80 ? "up" : metrics.healthScore >= 50 ? "neutral" : "down"}
        />
        <StatsCard
          title="Bounce Rate"
          value={`${metrics.bounceRate}%`}
          trend={metrics.bounceRate < 5 ? "up" : metrics.bounceRate < 10 ? "neutral" : "down"}
        />
        <StatsCard
          title="Open Rate"
          value={`${metrics.openRate}%`}
          trend={metrics.openRate > 30 ? "up" : metrics.openRate > 15 ? "neutral" : "down"}
        />
        <StatsCard
          title="Spam Rate"
          value={`${metrics.spamRate}%`}
          trend={metrics.spamRate < 1 ? "up" : metrics.spamRate < 3 ? "neutral" : "down"}
        />
      </div>
    </div>
  );
}
