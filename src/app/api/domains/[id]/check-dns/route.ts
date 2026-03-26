import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { runDomainDnsCheck } from "@/lib/dns-deliverability";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const result = await runDomainDnsCheck({
      domainId: id,
      userId: session.user.id,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to run DNS check";
    const status = message === "Domain not found" ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
