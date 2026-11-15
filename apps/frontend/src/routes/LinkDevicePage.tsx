import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiPost, ApiError } from "../lib/api";
import { PAGE_X } from "../lib/layout";

/** Claims a TV pairing code — reached either by scanning the TV's QR code (pre-fills ?code=) or by
 * typing the code shown on the TV screen by hand. Requires being logged in already (enforced by
 * ProtectedRoute in App.tsx, which preserves ?code= across a login redirect). See
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
    <main className={`w-full flex-1 ${PAGE_X} py-10`}>
      <div className="mb-7">
        <p className="font-display text-xs tracking-[0.16em] text-text-tertiary uppercase">Link a device</p>
        <h1 className="font-display text-4xl tracking-wide text-white">Sign in your TV</h1>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="grid gap-4 rounded-2xl border border-divider bg-surface p-5">
          {status === "done" ? (
            <>
              <div className="rounded-lg border border-live/25 bg-live/10 px-4 py-3 text-sm text-live">
                Done — your TV should sign in within a few seconds.
              </div>
              <Link
                to="/"
                className="inline-flex min-h-11 w-fit items-center rounded-lg border border-divider-strong px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-surface-hover"
              >
                Back to the library
              </Link>
            </>
          ) : (
            <form onSubmit={handleSubmit} className="grid gap-4">
              <div className="grid gap-1.5">
                <label htmlFor="pair-code" className="text-xs font-semibold tracking-wide text-text-secondary uppercase">
                  Code on the TV
                </label>
                <input
                  id="pair-code"
                  value={code}
                  onChange={(event) => setCode(event.target.value.toUpperCase())}
                  placeholder="XXXXXX"
                  autoFocus
                  maxLength={8}
                  aria-invalid={status === "error" ? true : undefined}
                  className="w-full rounded-lg border border-divider-strong bg-background px-4 py-3.5 text-center font-mono text-2xl font-bold tracking-[0.4em] text-white outline-none transition placeholder:text-white/25 focus:border-accent"
                />
              </div>
              {error && (
                <p role="alert" className="rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger">
                  {error}
                </p>
              )}
              <button
                type="submit"
                disabled={status === "pending" || !code.trim()}
                className="min-h-11 rounded-lg bg-accent px-5 py-2.5 text-sm font-bold text-black transition hover:brightness-110 disabled:opacity-50"
              >
                {status === "pending" ? "Linking…" : "Link device"}
              </button>
            </form>
          )}
        </section>

        <section className="grid content-start gap-3 rounded-2xl border border-divider bg-surface p-5">
          <h2 className="font-display text-xl tracking-wide text-white">How it works</h2>
          <ol className="grid gap-2 text-sm text-text-secondary">
            <li>1. Open Campfire on the TV and choose Sign in.</li>
            <li>2. The TV shows a short code (and a QR code you can scan with a phone).</li>
            <li>3. Type the code here. The TV signs in as you, with your watch progress.</li>
          </ol>
          <p className="text-xs text-text-tertiary">
            Codes are short-lived. If it fails, get a fresh code on the TV and try again.
          </p>
        </section>
      </div>
    </main>
  );
}
