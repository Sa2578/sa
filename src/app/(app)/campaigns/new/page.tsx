"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function NewCampaignPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    subject: "",
    bodyTemplate: "",
  });
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      // Create campaign
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        setError("Failed to create campaign");
        setLoading(false);
        return;
      }

      const campaign = await res.json();

      // Import CSV if provided
      if (csvFile) {
        const formData = new FormData();
        formData.append("file", csvFile);
        formData.append("campaignId", campaign.id);

        const importRes = await fetch("/api/leads/import", {
          method: "POST",
          body: formData,
        });

        if (!importRes.ok) {
          setError("Campaign created but CSV import failed");
        }
      }

      router.push(`/campaigns/${campaign.id}`);
    } catch {
      setError("Something went wrong");
    }

    setLoading(false);
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Create Campaign</h1>

      <Card>
        <form onSubmit={handleSubmit} className="space-y-6">
          <Input
            label="Campaign Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Q1 Outreach"
            required
          />

          <Input
            label="Email Subject"
            value={form.subject}
            onChange={(e) => setForm({ ...form, subject: e.target.value })}
            placeholder="Quick question about {{company}}"
            required
          />

          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">
              Email Body (HTML)
            </label>
            <textarea
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              rows={8}
              value={form.bodyTemplate}
              onChange={(e) => setForm({ ...form, bodyTemplate: e.target.value })}
              placeholder="<p>Hi {{name}},</p><p>I noticed...</p>"
              required
            />
          </div>

          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700">
              Import Leads (CSV)
            </label>
            <p className="text-xs text-gray-500">CSV must have an &quot;email&quot; column. Optional: &quot;name&quot;, &quot;company&quot;</p>
            <input
              type="file"
              accept=".csv"
              onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
              className="block w-full text-sm text-gray-500 file:mr-4 file:rounded-lg file:border-0 file:bg-blue-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-blue-700 hover:file:bg-blue-100"
            />
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-3">
            <Button variant="secondary" type="button" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Creating..." : "Create Campaign"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
