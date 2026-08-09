import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isAdminEmail } from "@/lib/admin";
import { unpublishVideo } from "@/lib/catalogVideos";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const session = await auth();
  if (!isAdminEmail(session?.user?.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { fileId } = await params;
  const { matched } = await unpublishVideo(fileId);
  if (!matched) {
    return NextResponse.json({ error: "Video is not currently published" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
