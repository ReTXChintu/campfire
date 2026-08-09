import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { isAdminEmail } from "@/lib/admin";
import { getCatalogFolder, curateFolder } from "@/lib/catalogFolders";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ folderId: string }> },
) {
  const session = await auth();
  if (!isAdminEmail(session?.user?.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { folderId } = await params;
  const folder = await getCatalogFolder(folderId);
  if (!folder) {
    return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }

  const body = await req.json();
  const { title } = body as { title?: string };
  const trimmedTitle = title?.trim();
  if (!trimmedTitle) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  await curateFolder(folderId, { title: trimmedTitle, curatedBy: session!.user!.email! });

  return NextResponse.json({ ok: true });
}
