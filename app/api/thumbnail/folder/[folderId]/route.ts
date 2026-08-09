import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { streamFile, readDriveHeader } from "@/lib/drive";
import { getCatalogFolder } from "@/lib/catalogFolders";
import { toWebStream } from "@/lib/webStream";

// Serves the full-resolution "thumbnail.*" image uploaded into a Drive folder — not Drive's own
// auto-generated (low-res) thumbnailLink preview used for videos, since this is a real admin-picked
// poster image and deserves full quality.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ folderId: string }> },
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { folderId } = await params;
  const folder = await getCatalogFolder(folderId);
  if (!folder?.thumbnailFileId) {
    return NextResponse.json({ error: "No thumbnail" }, { status: 404 });
  }

  try {
    const driveRes = await streamFile(folder.thumbnailFileId, null);
    const headers = new Headers();
    const contentType = readDriveHeader(driveRes.headers, "content-type");
    headers.set("content-type", contentType || "image/jpeg");
    headers.set("cache-control", "private, max-age=3600");
    return new NextResponse(toWebStream(driveRes.data), { status: 200, headers });
  } catch {
    return NextResponse.json({ error: "No thumbnail" }, { status: 404 });
  }
}
