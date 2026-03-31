"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, StatsCard } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table } from "@/components/ui/table";
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
  metrics: Metrics;
}

interface CampaignMetric {
  id: string;
  name: string;
  isSystem: boolean;
  metrics: Metrics;
}

interface Alert {
  id: string;
  type: string;
  severity: string;
  message: string;
  createdAt: string;
}

export default function DeliverabilityPage() {
  const [days, setDays] = useState("30");
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [timeSeries, setTimeSeries] = useState<TimeSeriesPoint[]>([]);
  const [domainMetrics, setDomainMetrics] = useState<DomainMetric[]>([]);
  const [inboxMetrics, setInboxMetrics] = useState<InboxMetric[]>([]);
  const [campaignMetrics, setCampaignMetrics] = useState<CampaignMetric[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);

  const fetchData = useCallback(async () => {
    const [metRes, alertRes] = await Promise.all([
      fetch(`/api/deliverability?days=${days}`),
      fetch("/api/deliverability/alerts"),
    ]);

    if (metRes.ok) {
      const data = await metRes.json();
      setMetrics(data.metrics);
      setTimeSeries(data.timeSeries);
      setDomainMetrics(data.domainMetrics);
      setInboxMetrics(data.inboxMetrics);
      setCampaignMetrics(data.campaignMetrics);
    }
    if (alertRes.ok) setAlerts(await alertRes.json());
  }, [days]);

  useEffect(() => { fetchData(); }, [fetchData]);

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
          Webmail clients like Gmail often fetch images through a proxy, so pixel opens are not a reliable source of truth.
          Use click and reply rates as the primary engagement signals.
        </p>
        <p className="mt-2 text-sm text-yellow-800">
          Current period proxy fetch rate: <strong>{metrics.proxyOpenRate}%</strong>. Verified opens are <strong>{metrics.verifiedOpenRate}%</strong>.
        </p>
        <p className="mt-2 text-sm text-yellow-800">
          Placement coverage is <strong>{metrics.placementCoverageRate}%</strong> across <strong>{metrics.placementSampleSize}</strong> sampled messages.
        </p>
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
          <h3 className="mb-4 text-lg font-semibold">Inbox Breakdown</h3>
          <Table
            data={inboxMetrics
              .filter((item) => item.metrics.totalSent > 0)
              .sort((left, right) => right.metrics.totalSent - left.metrics.totalSent)}
            emptyMessage="No inbox deliverability data yet"
            columns={[
              {
                key: "emailAddress",
                header: "Inbox",
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
                  item.metrics.placementSampleSize > 0
                    ? `${item.metrics.inboxPlacementRate}%`
                    : "No sample",
              },
            ]}
          />
        </Card>

        <Card>
          <h3 className="mb-4 text-lg font-semibold">Campaign Breakdown</h3>
          <Table
            data={campaignMetrics
              .filter((item) => item.metrics.totalSent > 0)
              .sort((left, right) => right.metrics.totalSent - left.metrics.totalSent)}
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
                  item.metrics.placementSampleSize > 0
                    ? `${item.metrics.inboxPlacementRate}%`
                    : "No sample",
              },
            ]}
          />
        </Card>
      </div>
    </div>
  );
}
