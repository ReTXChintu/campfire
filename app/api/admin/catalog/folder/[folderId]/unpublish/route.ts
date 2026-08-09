import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isAdminEmail } from "@/lib/admin";
import { unpublishFolder } from "@/lib/catalogFolders";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ folderId: string }> },
) {
  const session = await auth();
  if (!isAdminEmail(session?.user?.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { folderId } = await params;
  const { matched } = await unpublishFolder(folderId);
  if (!matched) {
    return NextResponse.json({ error: "Folder is not currently published" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
