import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { ApiError } from "../lib/api";

type Mode = "signin" | "signup";

const mobileAppDownloadUrl = import.meta.env.VITE_MOBILE_APP_DOWNLOAD_URL;

export default function LoginPage() {
  const { token, isLoading, login, signup } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl");

  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (token && !isLoading) navigate(callbackUrl || "/", { replace: true });
  }, [token, isLoading, callbackUrl, navigate]);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "signup") {
        await signup(email, password, name.trim() || undefined);
      } else {
        await login(email, password);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong — please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative flex flex-1 items-center justify-center overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: "radial-gradient(circle at 50% 30%, #3a1a12 0%, #1a0e12 40%, #0A0B0F 75%)",
        }}
      />
      <div className="relative flex w-full max-w-sm flex-col items-center gap-8 rounded-2xl border border-divider bg-surface/60 px-10 py-14 shadow-2xl shadow-black/50 backdrop-blur">
        <div className="flex flex-col items-center gap-2">
          <img src="/full_logo.png" alt="Campfire" className="h-32 w-auto" />
          <p className="text-sm text-text-secondary">Your library, ready to watch.</p>
        </div>

        <form onSubmit={onSubmit} className="flex w-full flex-col gap-4">
          {mode === "signup" && (
            <div>
              <label htmlFor="name" className="mb-1.5 block text-sm font-medium text-white/90">
                Name <span className="text-text-tertiary">(optional)</span>
              </label>
              <input
                id="name"
                type="text"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-md border border-divider bg-surface px-3 py-2 text-sm text-white outline-none focus:border-white/30"
              />
            </div>
          )}
          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-white/90">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-divider bg-surface px-3 py-2 text-sm text-white outline-none focus:border-white/30"
            />
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label htmlFor="password" className="block text-sm font-medium text-white/90">
                Password
              </label>
              {mode === "signin" && (
                <Link to="/reset-password" className="text-xs text-text-secondary underline-offset-2 hover:underline">
                  Forgot password?
                </Link>
              )}
            </div>
            <input
              id="password"
              type="password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              required
              minLength={mode === "signup" ? 8 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md border border-divider bg-surface px-3 py-2 text-sm text-white outline-none focus:border-white/30"
            />
            {mode === "signup" && (
              <p className="mt-1 text-xs text-text-tertiary">At least 8 characters.</p>
            )}
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={submitting || !email || !password}
            className="mt-2 rounded-lg bg-white px-6 py-3 text-sm font-bold text-black transition hover:bg-white/90 disabled:opacity-50"
          >
            {submitting ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
          </button>
        </form>

        <p className="text-sm text-text-secondary">
          {mode === "signup" ? "Already have an account?" : "Don't have an account?"}{" "}
          <button
            type="button"
            onClick={() => switchMode(mode === "signup" ? "signin" : "signup")}
            className="font-medium text-white underline-offset-2 hover:underline"
          >
            {mode === "signup" ? "Sign in" : "Sign up"}
          </button>
        </p>

        {mobileAppDownloadUrl && (
          <a
            href={mobileAppDownloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-full border border-divider px-3 py-1.5 text-xs font-medium text-white/90 transition hover:border-white/30 hover:text-white"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden="true">
              <path d="M12 2a1 1 0 0 1 1 1v10.59l3.3-3.3a1 1 0 1 1 1.4 1.42l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.42l3.3 3.3V3a1 1 0 0 1 1-1Z" />
              <path d="M5 20a1 1 0 0 1 1-1h12a1 1 0 1 1 0 2H6a1 1 0 0 1-1-1Z" />
            </svg>
            Get the App
          </a>
        )}
      </div>
    </div>
  );
}
