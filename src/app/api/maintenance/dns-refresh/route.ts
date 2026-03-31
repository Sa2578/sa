import { NextResponse } from "next/server";
import { z } from "zod";
import { runDomainDnsCheckBatch } from "@/lib/dns-deliverability";
import { isMaintenanceAuthorized } from "@/lib/webhook-auth";

const maintenanceDnsSchema = z.object({
  userId: z.string().trim().min(1).optional(),
  domainIds: z.array(z.string().trim().min(1)).max(100).optional(),
  maxDomains: z.number().int().min(1).max(100).optional(),
});

export async function POST(req: Request) {
  try {
    if (!isMaintenanceAuthorized(req)) {
      return NextResponse.json({ error: "Unauthorized maintenance request" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const parsed = maintenanceDnsSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    }

    const result = await runDomainDnsCheckBatch(parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to refresh DNS data";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
