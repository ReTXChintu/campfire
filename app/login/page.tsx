import { signIn } from "@/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;

  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 50% 30%, #3a1a12 0%, #1a0e12 40%, #0A0B0F 75%)",
        }}
      />
      <div className="relative flex flex-col items-center gap-8 rounded-2xl border border-divider bg-surface/60 px-12 py-14 shadow-2xl shadow-black/50 backdrop-blur">
        <div className="flex flex-col items-center gap-2">
          <h1 className="flex items-center gap-0.5 font-display text-6xl tracking-wide text-white">
            CAMPFIRE<span className="text-accent">•</span>
          </h1>
          <p className="text-sm text-text-secondary">Your library, ready to watch.</p>
        </div>
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: callbackUrl || "/" });
          }}
        >
          <button
            type="submit"
            className="flex items-center gap-3 rounded-lg bg-white px-6 py-3 font-medium text-black transition hover:scale-[1.02] hover:bg-white/90"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M23.52 12.27c0-.85-.08-1.66-.22-2.45H12v4.63h6.47c-.28 1.5-1.13 2.77-2.4 3.62v3h3.88c2.27-2.09 3.57-5.17 3.57-8.8z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.96-1.07 7.95-2.9l-3.88-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.26v3.11C3.24 21.3 7.28 24 12 24z"
              />
              <path
                fill="#FBBC05"
                d="M5.27 14.29A7.2 7.2 0 0 1 4.9 12c0-.79.14-1.56.37-2.29V6.6H1.26A11.98 11.98 0 0 0 0 12c0 1.94.46 3.77 1.26 5.4l4.01-3.11z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0 7.28 0 3.24 2.7 1.26 6.6l4.01 3.11C6.22 6.86 8.87 4.75 12 4.75z"
              />
            </svg>
            Sign in with Google
          </button>
        </form>
      </div>
    </div>
  );
}
