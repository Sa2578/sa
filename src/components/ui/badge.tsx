const colorMap: Record<string, string> = {
  green: "bg-green-100 text-green-800",
  yellow: "bg-yellow-100 text-yellow-800",
  red: "bg-red-100 text-red-800",
  blue: "bg-blue-100 text-blue-800",
  gray: "bg-gray-100 text-gray-800",
  purple: "bg-purple-100 text-purple-800",
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
