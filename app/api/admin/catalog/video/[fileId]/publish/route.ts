import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isAdminEmail } from "@/lib/admin";
import { publishVideo } from "@/lib/catalogVideos";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const session = await auth();
  if (!isAdminEmail(session?.user?.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { fileId } = await params;
  const { matched } = await publishVideo(fileId);
  if (!matched) {
    return NextResponse.json(
      { error: "Video must be curated (title set) before it can be published" },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true });
}
