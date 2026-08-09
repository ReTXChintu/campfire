import Link from "next/link";
import { signOut } from "@/auth";
import type { Session } from "next-auth";

export default function TopBar({
  session,
  isAdmin,
}: {
  session: Session | null;
  isAdmin: boolean;
}) {
  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-divider bg-black/80 px-4 py-4 backdrop-blur-md sm:px-6">
      <Link href="/" className="flex items-center gap-0.5 font-display text-3xl tracking-wide text-white">
        CAMPFIRE<span className="text-accent">•</span>
      </Link>
      {session?.user && (
        <div className="flex items-center gap-5 text-sm text-text-secondary">
          {isAdmin && (
            <Link href="/admin" className="font-medium transition hover:text-white">
              Admin
            </Link>
          )}
          <span className="hidden rounded-full bg-white/10 px-3 py-1 text-xs text-text-secondary sm:inline">
            {session.user.email}
          </span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button type="submit" className="transition hover:text-white">
              Sign out
            </button>
          </form>
          <div className="h-[30px] w-[30px] rounded-md bg-gradient-to-br from-accent to-amber" />
        </div>
      )}
    </header>
  );
}
