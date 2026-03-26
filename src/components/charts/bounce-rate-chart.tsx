"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

interface DataPoint {
  date: string;
  bounceRate: number;
  openRate: number;
  spamRate: number;
}

export function BounceRateChart({ data }: { data: DataPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="date" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} unit="%" />
        <Tooltip />
        <Legend />
        <Line
          type="monotone"
          dataKey="bounceRate"
          stroke="#ef4444"
          name="Bounce Rate"
          strokeWidth={2}
        />
        <Line
          type="monotone"
          dataKey="openRate"
          stroke="#22c55e"
          name="Open Rate"
          strokeWidth={2}
        />
        <Line
          type="monotone"
          dataKey="spamRate"
          stroke="#f59e0b"
          name="Spam Rate"
          strokeWidth={2}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
