import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { apiPost, ApiError } from "../lib/api";

/** Claims a TV pairing code — reached either by scanning the TV's QR code (pre-fills ?code=) or by
 * typing the code shown on the TV screen by hand. Requires being logged in already (enforced by
 * ProtectedRoute in App.tsx, which now preserves ?code= across a login redirect). See
 * apps/backend/src/routes/auth.ts's POST /auth/pair/claim. */
export default function LinkDevicePage() {
  const [searchParams] = useSearchParams();
  const [code, setCode] = useState(() => (searchParams.get("code") ?? "").toUpperCase());
  const [status, setStatus] = useState<"idle" | "pending" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    setStatus("pending");
    setError(null);
    try {
      await apiPost("/auth/pair/claim", { code: trimmed });
      setStatus("done");
    } catch (err) {
      setStatus("error");
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-sm flex-1 flex-col items-center justify-center gap-6 px-4 py-16">
      <div className="text-center">
        <p className="text-xs uppercase tracking-[0.25em] text-white/45">Link a device</p>
        <h1 className="mt-1 text-xl font-semibold text-white">Sign in your TV</h1>
        <p className="mt-2 text-sm text-white/60">Enter the code shown on your TV screen.</p>
      </div>

      {status === "done" ? (
        <div className="w-full rounded-lg border border-live/25 bg-live/10 px-4 py-3 text-center text-sm text-live">
          Done — your TV should sign in within a few seconds.
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex w-full flex-col items-center gap-3">
          <input
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="XXXXXX"
            autoFocus
            maxLength={8}
            className="w-full rounded-lg border border-divider-strong bg-surface-hover px-4 py-3 text-center text-2xl font-bold tracking-[0.4em] text-white outline-none placeholder:text-white/25 focus:border-accent"
          />
          {error && <p className="text-sm text-danger">{error}</p>}
          <button
            type="submit"
            disabled={status === "pending" || !code.trim()}
            className="w-full rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:bg-white/30"
          >
            {status === "pending" ? "Linking..." : "Link device"}
          </button>
        </form>
      )}
    </div>
  );
}
