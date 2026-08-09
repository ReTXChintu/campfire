import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getThumbnail } from "@/lib/drive";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { fileId } = await params;

  try {
    const thumbRes = await getThumbnail(fileId);
    if (!thumbRes || !thumbRes.body) {
      return NextResponse.json({ error: "No thumbnail" }, { status: 404 });
    }

    return new NextResponse(thumbRes.body, {
      status: 200,
      headers: {
        "content-type": thumbRes.headers.get("content-type") || "image/jpeg",
        "cache-control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "No thumbnail" }, { status: 404 });
  }
}
