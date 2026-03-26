import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { domainSchema } from "@/lib/validators";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const domains = await prisma.domain.findMany({
    where: { userId: session.user.id },
    include: { _count: { select: { inboxes: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(domains);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const parsed = domainSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    }

    const domain = await prisma.domain.create({
      data: { ...parsed.data, userId: session.user.id },
    });

    return NextResponse.json(domain, { status: 201 });
  } catch (error) {
    const message =
      error instanceof Error && error.message.includes("Unique constraint")
        ? "Domain already exists"
        : "Internal server error";

    return NextResponse.json({ error: message }, { status: message === "Internal server error" ? 500 : 409 });
  }
}
