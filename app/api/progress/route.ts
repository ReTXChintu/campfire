import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getProgress, upsertProgress } from "@/lib/progress";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const fileId = req.nextUrl.searchParams.get("fileId");
  if (!fileId) {
    return NextResponse.json({ error: "fileId is required" }, { status: 400 });
  }

  const progress = await getProgress(session.user.id, fileId);
  return NextResponse.json({ progress });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { fileId, parentFolderId, positionSeconds, durationSeconds } = body as {
    fileId?: string;
    parentFolderId?: string;
    positionSeconds?: number;
    durationSeconds?: number;
  };

  if (
    !fileId ||
    !parentFolderId ||
    typeof positionSeconds !== "number" ||
    typeof durationSeconds !== "number"
  ) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  await upsertProgress({
    userId: session.user.id,
    fileId,
    parentFolderId,
    positionSeconds,
    durationSeconds,
  });

  return NextResponse.json({ ok: true });
}
