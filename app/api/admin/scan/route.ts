import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isAdminEmail } from "@/lib/admin";
import { runScan } from "@/lib/catalogScan";
import { ensureIndexes as ensureCatalogVideoIndexes } from "@/lib/catalogVideos";
import { ensureIndexes as ensureCatalogFolderIndexes } from "@/lib/catalogFolders";

export const runtime = "nodejs";

export async function POST() {
  const session = await auth();
  if (!isAdminEmail(session?.user?.email)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await Promise.all([ensureCatalogVideoIndexes(), ensureCatalogFolderIndexes()]);
  const result = await runScan();
  return NextResponse.json(result);
}
