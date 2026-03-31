import { ReactNode } from "react";

interface CardProps {
  children: ReactNode;
  className?: string;
}

export function Card({ children, className = "" }: CardProps) {
  return (
    <div
      className={`rounded-xl border border-gray-200 bg-white p-6 shadow-sm shadow-slate-200/40 dark:border-slate-700 dark:bg-slate-900 dark:shadow-black/20 ${className}`}
    >
      {children}
    </div>
  );
}

interface StatsCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: "up" | "down" | "neutral";
}

export function StatsCard({ title, value, subtitle, trend }: StatsCardProps) {
  const trendColors = {
    up: "text-green-600 dark:text-green-400",
    down: "text-red-600 dark:text-red-400",
    neutral: "text-gray-500 dark:text-slate-400",
  };

  return (
    <Card>
      <p className="text-sm font-medium text-gray-500 dark:text-slate-400">{title}</p>
      <p className="mt-1 text-3xl font-bold text-gray-900 dark:text-slate-50">{value}</p>
      {subtitle && (
        <p className={`mt-1 text-sm ${trend ? trendColors[trend] : "text-gray-500"}`}>
          {subtitle}
        </p>
      )}
    </Card>
  );
}
