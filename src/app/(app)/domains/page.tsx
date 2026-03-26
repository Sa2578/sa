"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Table } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/badge";

interface Domain {
  id: string;
  domainName: string;
  status: string;
  spfValid: boolean;
  dkimValid: boolean;
  dmarcValid: boolean;
  _count: { inboxes: number };
  createdAt: string;
}

export default function DomainsPage() {
  const router = useRouter();
  const [domains, setDomains] = useState<Domain[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ domainName: "", status: "ACTIVE" });
  const [loading, setLoading] = useState(false);

  const fetchDomains = useCallback(async () => {
    const res = await fetch("/api/domains");
    if (res.ok) setDomains(await res.json());
  }, []);

  useEffect(() => { fetchDomains(); }, [fetchDomains]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch("/api/domains", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      setShowModal(false);
      setForm({ domainName: "", status: "ACTIVE" });
      fetchDomains();
    }
    setLoading(false);
  }

  const columns = [
    { key: "domainName", header: "Domain" },
    {
      key: "status",
      header: "Status",
      render: (d: Domain) => <StatusBadge status={d.status} />,
    },
    {
      key: "dns",
      header: "DNS",
      render: (d: Domain) => (
        <div className="flex gap-2">
          <span className={d.spfValid ? "text-green-600" : "text-red-500"}>SPF</span>
          <span className={d.dkimValid ? "text-green-600" : "text-red-500"}>DKIM</span>
          <span className={d.dmarcValid ? "text-green-600" : "text-red-500"}>DMARC</span>
        </div>
      ),
    },
    {
      key: "inboxes",
      header: "Inboxes",
      render: (d: Domain) => d._count.inboxes,
    },
  ];

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Domains</h1>
        <Button onClick={() => setShowModal(true)}>Add Domain</Button>
      </div>

      <Table
        columns={columns}
        data={domains}
        onRowClick={(d) => router.push(`/domains/${d.id}`)}
        emptyMessage="No domains yet. Add your first domain to get started."
      />

      <Modal open={showModal} onClose={() => setShowModal(false)} title="Add Domain">
        <form onSubmit={handleCreate} className="space-y-4">
          <Input
            label="Domain Name"
            placeholder="example.com"
            value={form.domainName}
            onChange={(e) => setForm({ ...form, domainName: e.target.value })}
            required
          />
          <Select
            label="Status"
            value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value })}
            options={[
              { value: "ACTIVE", label: "Active" },
              { value: "WARMUP", label: "Warmup" },
              { value: "PAUSED", label: "Paused" },
            ]}
          />
          <div className="flex justify-end gap-3">
            <Button variant="secondary" type="button" onClick={() => setShowModal(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Creating..." : "Create"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
