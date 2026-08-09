import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { auth } from "@/auth";
import { isAdminEmail } from "@/lib/admin";
import { downloadFilePath, deleteDownloadFile } from "@/lib/downloads";
import { toWebStream } from "@/lib/webStream";

export const runtime = "nodejs";

// Serves a locally-converted MP4 for the admin to save to their own device, then deletes the temp
// file once the response has finished streaming — nothing here ever touches Drive.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ downloadId: string }> },
) {
  const session = await auth();
  if (!isAdminEmail(session?.user?.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { downloadId } = await params;
  const filename = req.nextUrl.searchParams.get("filename") || "video.mp4";

  let filePath: string;
  let size: number;
  try {
    filePath = downloadFilePath(downloadId);
    size = (await stat(filePath)).size;
  } catch {
    return NextResponse.json({ error: "Download not found" }, { status: 404 });
  }

  const stream = toWebStream(createReadStream(filePath));

  after(async () => {
    await deleteDownloadFile(downloadId);
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(size),
      "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
    },
  });
}
