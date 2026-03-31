const colorMap: Record<string, string> = {
  green: "bg-green-100 text-green-800 dark:bg-green-950/60 dark:text-green-300",
  yellow: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950/60 dark:text-yellow-300",
  red: "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300",
  blue: "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300",
  gray: "bg-gray-100 text-gray-800 dark:bg-slate-800 dark:text-slate-200",
  purple: "bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300",
};

interface BadgeProps {
  color?: string;
  children: React.ReactNode;
}

export function Badge({ color = "gray", children }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${colorMap[color] || colorMap.gray}`}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { color: string; label: string }> = {
    ACTIVE: { color: "green", label: "Active" },
    WARMUP: { color: "yellow", label: "Warmup" },
    FLAGGED: { color: "red", label: "Flagged" },
    PAUSED: { color: "gray", label: "Paused" },
    DRAFT: { color: "gray", label: "Draft" },
    COMPLETED: { color: "blue", label: "Completed" },
    NEW: { color: "blue", label: "New" },
    CONTACTED: { color: "purple", label: "Contacted" },
    REPLIED: { color: "green", label: "Replied" },
    BOUNCED: { color: "red", label: "Bounced" },
    SENT: { color: "blue", label: "Sent" },
    DELIVERED: { color: "green", label: "Delivered" },
    OPENED: { color: "green", label: "Opened" },
    CLICKED: { color: "purple", label: "Clicked" },
    SPAM: { color: "red", label: "Spam" },
    FAILED: { color: "red", label: "Failed" },
    QUEUED: { color: "yellow", label: "Queued" },
    NONE: { color: "gray", label: "None" },
    IN_PROGRESS: { color: "yellow", label: "In Progress" },
  };

  const entry = map[status] || { color: "gray", label: status };
  return <Badge color={entry.color}>{entry.label}</Badge>;
}
